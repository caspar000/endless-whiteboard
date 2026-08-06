import {
	ArrowDown,
	ArrowDownToLine,
	ArrowUp,
	ArrowUpToLine,
	Check,
	Clipboard,
	Copy,
	ImageDown,
	MoreHorizontal,
	Scissors,
	SlidersHorizontal,
	Trash2,
	X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
	AssetRecordType,
	Box,
	DefaultColorStyle,
	getColorValue,
	DefaultImageToolbarContent,
	DefaultVideoToolbarContent,
	TldrawUiContextualToolbar,
	TldrawUiToolbarButton,
	useActions,
	useEditor,
	useValue,
	type Editor,
	type TLImageAsset,
	type TLImageShape,
	type TLShapeId,
	type TLVideoShape,
} from 'tldraw'
import { hashFromAssetSrc, assetSrcForHash, isManagedAssetSrc } from '../persistence/assetStore'
import { sha256Hex } from '../persistence/hash'
import {
	removeImageBackground,
	type RemoveBackgroundResult,
} from '../persistence/removeBackground'
import { usePlatform } from '../platform/PlatformContext'
import { openProperties } from './propertiesTarget'

/**
 * The frame's border colour, as a row of rings.
 *
 * Rings rather than filled swatches because that is what a frame now is: an outline round nothing. A
 * solid dot would advertise a fill the shape does not have.
 *
 * The ring is painted with the *same* value the border will take — `frameStroke` from tldraw's own
 * theme for that colour and the active colour mode — so the swatch is the thing itself rather than an
 * approximation of it, and it stays right in both themes.
 */
function FrameColorRings({ shapeId }: { shapeId: TLShapeId }) {
	const editor = useEditor()
	const frame = useValue(
		'lb:frame-color',
		() => {
			const shape = editor.getShape(shapeId)
			if (shape?.type !== 'frame') return null
			return {
				current: (shape.props as { color: string }).color,
				colors: editor.getCurrentTheme().colors[editor.getColorMode()],
			}
		},
		[editor, shapeId]
	)
	if (!frame) return null

	return (
		<>
			<div className="lb-seltb__rings" role="group" aria-label="Frame colour">
				{DefaultColorStyle.values.map((value) => (
					<button
						key={value}
						className={value === frame.current ? 'lb-ring lb-ring--active' : 'lb-ring'}
						style={{ borderColor: getColorValue(frame.colors, value, 'frameStroke') }}
						title={value}
						aria-label={`Frame colour ${value}`}
						aria-pressed={value === frame.current}
						// Keep focus on the canvas so tool shortcuts keep working.
						onPointerDown={(e) => e.preventDefault()}
						onClick={() =>
							// The style-prop API rather than a raw `updateShape`: `color` is a real style prop
							// once `showColors` is on, so this is what tldraw's own history and multi-select
							// semantics are built around. Deliberately *not* `setStyleForNextShapes` — that
							// would repaint the next pen stroke to match a frame, which nobody asked for.
							editor.setStyleForSelectedShapes(DefaultColorStyle, value)
						}
					/>
				))}
			</div>
			<div className="lb-seltb__sep" />
		</>
	)
}

/**
 * Where the shape has to move and how big it has to be so that trimming the transparent margin leaves
 * the subject exactly where it was on the canvas.
 *
 * The image shrinks to its content, so without moving the shape by the same amount the picture would
 * appear to jump up and left by the size of the margin that was cut.
 *
 * Three things make this more than a subtraction:
 *  - **Flips.** A flipped image is drawn mirrored, so a margin trimmed from the source's left edge is
 *    on screen at the *right*, and the shape's origin must not move for it.
 *  - **Rotation.** `x`/`y` live in the parent's space while the trim is measured in the shape's own,
 *    so the offset is rotated before it is applied. Skipping this sends a rotated cut-out sideways.
 *  - **Scale.** The shape's size and the asset's pixel size are independent; the offset is in canvas
 *    units, not pixels.
 */
function trimGeometry(shape: TLImageShape, result: RemoveBackgroundResult) {
	const { trimmed, sourceWidth, sourceHeight } = result
	if (!trimmed || sourceWidth === 0 || sourceHeight === 0) {
		return { x: shape.x, y: shape.y, props: {} as Partial<TLImageShape['props']> }
	}

	const scaleX = shape.props.w / sourceWidth
	const scaleY = shape.props.h / sourceHeight

	const localX = (shape.props.flipX ? sourceWidth - (trimmed.x + trimmed.w) : trimmed.x) * scaleX
	const localY = (shape.props.flipY ? sourceHeight - (trimmed.y + trimmed.h) : trimmed.y) * scaleY

	const cos = Math.cos(shape.rotation)
	const sin = Math.sin(shape.rotation)

	return {
		x: shape.x + localX * cos - localY * sin,
		y: shape.y + localX * sin + localY * cos,
		props: { w: trimmed.w * scaleX, h: trimmed.h * scaleY } as Partial<TLImageShape['props']>,
	}
}

/**
 * "Remove background" on a selected image.
 *
 * A flood fill from the image's edges (see `persistence/removeBackground.ts`) — no model, no download,
 * works offline. It is the right tool for what a whiteboard is mostly full of: screenshots, logos,
 * diagrams, product shots on white. It is not subject lifting, and on a photographed scene it will
 * politely do very little, which is what the "nothing to remove" case reports.
 *
 * The result becomes a *new* asset record rather than overwriting the old one's `src`. Two reasons:
 * the same image may be on the board twice and only this copy was asked to change, and leaving the
 * original asset in the store is what keeps undo safe — GC walks asset records, not shapes, so the
 * original blob stays reachable and a redo has something to point back at.
 */
function RemoveBackgroundButton({ shapeId }: { shapeId: TLImageShape['id'] }) {
	const editor = useEditor()
	const platform = usePlatform()
	const [busy, setBusy] = useState(false)
	const [note, setNote] = useState<string | null>(null)

	useEffect(() => {
		if (!note) return
		const timer = setTimeout(() => setNote(null), 2400)
		return () => clearTimeout(timer)
	}, [note])

	// Only for images we actually hold the bytes of. A bookmark's remote preview, or an asset still
	// uploading, has nothing local to read.
	const src = useValue(
		'lb:bg-src',
		() => {
			const shape = editor.getShape<TLImageShape>(shapeId)
			const assetId = shape?.props.assetId
			if (!assetId) return null
			const asset = editor.getAsset(assetId)
			const value = asset?.props.src
			return typeof value === 'string' && isManagedAssetSrc(value) ? value : null
		},
		[editor, shapeId]
	)
	if (!src) return null

	const removeBackground = async () => {
		setBusy(true)
		try {
			const source = await platform.blobs.get(hashFromAssetSrc(src))
			if (!source) {
				setNote('Image not found')
				return
			}

			const before = editor.getShape<TLImageShape>(shapeId)
			if (!before) return

			const result = await removeImageBackground(source, {
				// A crop addresses the asset's pixels, so resizing the asset underneath one would put it
				// somewhere else entirely. Background removal itself is fine — it replaces the pixels at
				// the same size — so only the trim is skipped.
				trim: before.props.crop === null,
			})
			const { blob, removed } = result

			// Below this, the fill found a border colour that matches almost nothing — saying so is
			// better than writing a new asset identical to the old one and calling it success.
			if (removed < 0.005) {
				setNote('Nothing to remove')
				return
			}
			// And above this there would be no picture left. Replacing an image with a transparent
			// rectangle is never what was wanted, so refuse rather than "succeed".
			if (removed > 0.995) {
				setNote('Nothing to keep')
				return
			}

			const hash = await sha256Hex(blob)
			await platform.blobs.put(hash, blob)

			const shape = editor.getShape<TLImageShape>(shapeId)
			const previous = shape?.props.assetId ? editor.getAsset(shape.props.assetId) : undefined
			if (!shape || previous?.type !== 'image') return

			const asset: TLImageAsset = {
				...previous,
				id: AssetRecordType.createId(),
				props: {
					...previous.props,
					src: assetSrcForHash(hash),
					mimeType: 'image/webp',
					w: result.width,
					h: result.height,
					// Recomputed: the cut-out is a different number of bytes, and the storage panel adds
					// these up.
					fileSize: blob.size,
				},
			}

			const geometry = trimGeometry(shape, result)

			// One `run`, so creating the asset, resizing and repositioning are a single undo entry.
			editor.run(() => {
				editor.markHistoryStoppingPoint('remove background')
				editor.createAssets([asset])
				editor.updateShape<TLImageShape>({
					id: shapeId,
					type: 'image',
					...geometry,
					props: { assetId: asset.id, ...geometry.props },
				})
			})
		} catch (err) {
			console.warn('Lifeboard: could not remove the background', err)
			setNote('Could not process this image')
		} finally {
			setBusy(false)
		}
	}

	return (
		<TldrawUiToolbarButton
			type="icon"
			title={note ?? 'Remove background'}
			data-testid="lb.remove-background"
			disabled={busy}
			onClick={() => void removeBackground()}
		>
			{note ? (
				<span className="lb-seltb__note">{note}</span>
			) : (
				<Scissors size={16} aria-hidden="true" />
			)}
			<span className="lb-sr-only">Remove background</span>
		</TldrawUiToolbarButton>
	)
}

/**
 * The one selection toolbar — Affine's "Display in Page …" bar, merged with tldraw's own
 * shape-specific toolbars.
 *
 * Built on tldraw's `TldrawUiContextualToolbar`, which owns the hard parts: positioning above the
 * selection in container coordinates, tracking the camera, and hiding while a crop drag is in
 * flight. Selecting an image or video gets that shape's native actions (replace, crop, download,
 * alt text) *inside this bar*, by embedding tldraw's own content components — the separate
 * `ImageToolbar`/`VideoToolbar` are disabled in Board.tsx, so there is never a second floating bar
 * competing with this one.
 */
export function SelectionToolbar() {
	const editor = useEditor()

	const info = useValue(
		'lb:selection-toolbar',
		() => {
			if (editor.getEditingShapeId()) return null
			// The same states tldraw's own contextual toolbars use: idle, the mousedown-on-shape
			// moment (avoids flicker on click), and crop mode. Anything else — translating,
			// brushing, resizing — hides the bar.
			if (!editor.isInAny('select.idle', 'select.pointing_shape', 'select.crop')) return null
			// ...but not while a crop handle is actually being dragged.
			if (
				editor.isInAny(
					'select.crop.cropping',
					'select.crop.pointing_crop_handle',
					'select.crop.translating_crop'
				)
			) {
				return null
			}
			const ids = editor.getSelectedShapeIds()
			if (ids.length === 0) return null
			const only = editor.getOnlySelectedShape()
			return {
				ids,
				onlyId: only?.id ?? null,
				media:
					only?.type === 'image'
						? ('image' as const)
						: only?.type === 'video'
							? ('video' as const)
							: null,
				isCropping: editor.isIn('select.crop'),
			}
		},
		[editor]
	)

	// Mirrors DefaultImageToolbar: while the crop tool is active the selection bounds jump around,
	// so the bar keeps the position it had when cropping started; a camera move invalidates it.
	const previousBounds = useRef<Box | undefined>(undefined)
	const camera = useValue('lb:seltb-camera', () => editor.getCamera(), [editor])
	useEffect(() => {
		previousBounds.current = undefined
	}, [camera])

	const isCropping = info?.isCropping ?? false
	const getSelectionBounds = useCallback(() => {
		if (isCropping && previousBounds.current) return previousBounds.current
		const fullBounds = editor.getSelectionScreenBounds()
		if (!fullBounds) return undefined
		// Height 0: the toolbar floats above the selection's top edge.
		const bounds = new Box(fullBounds.x, fullBounds.y, fullBounds.width, 0)
		previousBounds.current = bounds
		return bounds
	}, [editor, isCropping])

	if (!info) return null

	return (
		<TldrawUiContextualToolbar
			key={info.onlyId ?? 'multi'}
			className="lb-seltb"
			getSelectionBounds={getSelectionBounds}
			label="Selection actions"
		>
			<SelectionToolbarContent
				ids={info.ids}
				onlyId={info.onlyId}
				media={info.media}
				isCropping={info.isCropping}
			/>
		</TldrawUiContextualToolbar>
	)
}

function SelectionToolbarContent({
	ids,
	onlyId,
	media,
	isCropping,
}: {
	ids: TLShapeId[]
	onlyId: TLShapeId | null
	media: 'image' | 'video' | null
	isCropping: boolean
}) {
	const editor = useEditor()
	const actions = useActions()
	const [menuOpen, setMenuOpen] = useState(false)
	const [editingAlt, setEditingAlt] = useState(false)

	// A different selection means a different bar; an open menu or alt editor must not carry over.
	const selectionKey = ids.join(',')
	useEffect(() => {
		setMenuOpen(false)
		setEditingAlt(false)
	}, [selectionKey])

	useEffect(() => {
		if (!menuOpen) return
		const close = () => setMenuOpen(false)
		// `pointerdown` so the menu is gone before the click lands on the canvas underneath.
		document.addEventListener('pointerdown', close)
		return () => document.removeEventListener('pointerdown', close)
	}, [menuOpen])

	const run = (id: string) => {
		setMenuOpen(false)
		actions[id]?.onSelect('menu')
	}

	const single = ids.length === 1

	if (editingAlt && onlyId) {
		return <AltTextEditor shapeId={onlyId} onClose={() => setEditingAlt(false)} />
	}

	// Mid-crop, the bar is the crop bar: tldraw's zoom slider and done button, nothing else.
	if (isCropping && media === 'image' && onlyId) {
		return (
			<DefaultImageToolbarContent
				imageShapeId={onlyId as TLImageShape['id']}
				isManipulating
				onEditAltTextStart={() => setEditingAlt(true)}
				onManipulatingStart={() => editor.setCurrentTool('select.crop.idle')}
				onManipulatingEnd={() => {
					editor.setCroppingShape(null)
					editor.setCurrentTool('select.idle')
				}}
			/>
		)
	}

	return (
		<>
			{onlyId && <FrameColorRings shapeId={onlyId} />}
			{media === 'image' && onlyId && (
				<>
					<DefaultImageToolbarContent
						imageShapeId={onlyId as TLImageShape['id']}
						isManipulating={false}
						onEditAltTextStart={() => setEditingAlt(true)}
						onManipulatingStart={() => editor.setCurrentTool('select.crop.idle')}
						onManipulatingEnd={() => {
							editor.setCroppingShape(null)
							editor.setCurrentTool('select.idle')
						}}
					/>
					<RemoveBackgroundButton shapeId={onlyId as TLImageShape['id']} />
					<div className="lb-seltb__sep" />
				</>
			)}
			{media === 'video' && onlyId && (
				<>
					<DefaultVideoToolbarContent
						videoShapeId={onlyId as TLVideoShape['id']}
						onEditAltTextStart={() => setEditingAlt(true)}
					/>
					<div className="lb-seltb__sep" />
				</>
			)}

			{single && (
				<>
					<TldrawUiToolbarButton
						type="icon"
						className="lb-seltb__props"
						tooltip="Properties (⌥P)"
						onClick={() => openProperties(ids[0]!)}
					>
						<SlidersHorizontal size={16} aria-hidden="true" />
						<span className="lb-seltb__props-label">Properties</span>
					</TldrawUiToolbarButton>
					<div className="lb-seltb__sep" />
				</>
			)}

			<TldrawUiToolbarButton
				type="icon"
				tooltip="Duplicate (⌘D)"
				title="Duplicate"
				onClick={() => run('duplicate')}
			>
				<Copy size={16} aria-hidden="true" />
			</TldrawUiToolbarButton>
			<TldrawUiToolbarButton
				type="icon"
				tooltip="Delete (⌫)"
				title="Delete"
				onClick={() => run('delete')}
			>
				<Trash2 size={16} aria-hidden="true" />
			</TldrawUiToolbarButton>

			<div className="lb-seltb__sep" />

			<div className="lb-seltb__more">
				<TldrawUiToolbarButton
					type="icon"
					tooltip="More options"
					title="More options"
					isActive={menuOpen}
					onClick={() => setMenuOpen((open) => !open)}
					aria-expanded={menuOpen}
				>
					<MoreHorizontal size={16} aria-hidden="true" />
				</TldrawUiToolbarButton>

				{menuOpen && (
					<div className="lb-seltb__menu" onPointerDown={(e) => e.stopPropagation()}>
						<button className="lb-seltb__item" onClick={() => run('bring-to-front')}>
							<ArrowUpToLine size={15} aria-hidden="true" /> Bring to front
						</button>
						<button className="lb-seltb__item" onClick={() => run('bring-forward')}>
							<ArrowUp size={15} aria-hidden="true" /> Bring forward
						</button>
						<button className="lb-seltb__item" onClick={() => run('send-backward')}>
							<ArrowDown size={15} aria-hidden="true" /> Send backward
						</button>
						<button className="lb-seltb__item" onClick={() => run('send-to-back')}>
							<ArrowDownToLine size={15} aria-hidden="true" /> Send to back
						</button>
						<div className="lb-seltb__menu-sep" />
						<button className="lb-seltb__item" onClick={() => run('copy')}>
							<Clipboard size={15} aria-hidden="true" /> Copy
						</button>
						<button className="lb-seltb__item" onClick={() => run('copy-as-png')}>
							<ImageDown size={15} aria-hidden="true" /> Copy as image
						</button>
						<button className="lb-seltb__item" onClick={() => run('duplicate')}>
							<Copy size={15} aria-hidden="true" /> Duplicate
						</button>
						{single && (
							<>
								<div className="lb-seltb__menu-sep" />
								<button
									className="lb-seltb__item"
									onClick={() => {
										setMenuOpen(false)
										openProperties(ids[0]!)
									}}
								>
									<SlidersHorizontal size={15} aria-hidden="true" /> Properties
								</button>
							</>
						)}
						<div className="lb-seltb__menu-sep" />
						<button className="lb-seltb__item lb-seltb__item--danger" onClick={() => run('delete')}>
							<Trash2 size={15} aria-hidden="true" /> Delete
						</button>
					</div>
				)}
			</div>
		</>
	)
}

/**
 * Inline alt-text editor, shown in place of the bar's buttons. tldraw's own `AltTextEditor` is not
 * exported, so this is the same idea in miniature: one input writing `props.altText`.
 */
function AltTextEditor({ shapeId, onClose }: { shapeId: TLShapeId; onClose: () => void }) {
	const editor = useEditor()
	const shape = editor.getShape(shapeId)
	const initial =
		shape && 'altText' in shape.props && typeof shape.props.altText === 'string'
			? shape.props.altText
			: ''
	const [value, setValue] = useState(initial)

	const save = () => {
		if (!shape) return onClose()
		// `as never`: the update is only offered for shapes that carry `altText` (image, video), but
		// `shape.type` is the full union here and TS can't narrow the props to match it.
		editor.updateShapes([
			{ id: shapeId, type: shape.type, props: { altText: value.trim() } } as never,
		])
		onClose()
	}

	return (
		<div className="lb-seltb__alt">
			{/* eslint-disable-next-line jsx-a11y/no-autofocus */}
			<input
				autoFocus
				className="lb-seltb__alt-input"
				placeholder="Describe this media…"
				aria-label="Alt text"
				value={value}
				onChange={(e) => setValue(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === 'Enter') save()
					if (e.key === 'Escape') onClose()
					// Otherwise the canvas reads keystrokes as tool shortcuts.
					e.stopPropagation()
				}}
			/>
			<TldrawUiToolbarButton type="icon" tooltip="Save" title="Save" onClick={save}>
				<Check size={16} aria-hidden="true" />
			</TldrawUiToolbarButton>
			<TldrawUiToolbarButton type="icon" tooltip="Cancel" title="Cancel" onClick={onClose}>
				<X size={16} aria-hidden="true" />
			</TldrawUiToolbarButton>
		</div>
	)
}
