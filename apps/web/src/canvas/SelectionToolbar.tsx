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
import { removeImageBackground } from '../persistence/removeBackground'
import { usePlatform } from '../platform/PlatformContext'
import { openProperties } from './propertiesTarget'

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

			const { blob, removed } = await removeImageBackground(source)
			// Below this, the fill found a border colour that matches almost nothing — saying so is
			// better than writing a new asset identical to the old one and calling it success.
			if (removed < 0.005) {
				setNote('Nothing to remove')
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
					// Recomputed: the cut-out is a different number of bytes, and the storage panel adds
					// these up.
					fileSize: blob.size,
				},
			}

			// One `run`, so creating the asset and repointing the shape are a single undo entry.
			editor.run(() => {
				editor.markHistoryStoppingPoint('remove background')
				editor.createAssets([asset])
				editor.updateShape<TLImageShape>({
					id: shapeId,
					type: 'image',
					props: { assetId: asset.id },
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
