import { getAssetBridge } from '@lifeboard/node-kit'
import type { Editor, TLBookmarkShape } from '@lifeboard/canvas'
import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type PointerEvent } from 'react'
import { downscaleImage } from '../../persistence/downscale'
import { cropWindow, editsMeta, linkDomain, parseTypedUrl, readEdits, type LinkPreviewContent, type LinkPreviewEdits } from './linkPreview'
import { fillBookmark } from './linkPreviewAsset'

/** Pictures someone can give a card: the ones that can be shown and can't run anything. */
const PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']

/**
 * The card's inspector, beside it while it's being edited: its name, its address (and reading the page
 * again), its picture, and which part of the picture the square shows.
 *
 * Every change goes straight onto the card, as the inspector's fields change, and the whole edit is one
 * step to undo: the select tool marks the history as editing starts.
 */
export function LinkPreviewInspector({
	editor,
	shape,
	content,
	image,
	imageSize,
}: {
	editor: Editor
	shape: TLBookmarkShape
	content: LinkPreviewContent
	image: string | null
	imageSize: { w: number; h: number } | null
}) {
	const edits = readEdits(shape)
	const [address, setAddress] = useState(shape.props.url)
	const [addressError, setAddressError] = useState('')
	const [status, setStatus] = useState('')
	const [fetching, setFetching] = useState(false)
	const fileInput = useRef<HTMLInputElement>(null)
	const titleInput = useRef<HTMLInputElement>(null)

	// The address shown follows the card's when it changes from elsewhere (undo, another device).
	useEffect(() => setAddress(shape.props.url), [shape.props.url])
	useEffect(() => titleInput.current?.focus(), [])

	const current = () => editor.getShape<TLBookmarkShape>(shape.id)
	const edit = (patch: Partial<LinkPreviewEdits>) => {
		const now = current()
		if (!now) return
		editor.updateShape<TLBookmarkShape>({ id: now.id, type: 'bookmark', meta: editsMeta({ ...readEdits(now), ...patch }) })
	}

	const close = () => {
		editor.setEditingShape(null)
		editor.setSelectedShapes([shape.id])
	}

	const commitAddress = () => {
		const url = parseTypedUrl(address)
		if (!url) {
			setAddressError('Enter a full web address, like audeze.com/products/lcd-2. The card keeps its last good one.')
			return
		}
		setAddressError('')
		setAddress(url)
		if (url !== current()?.props.url) editor.updateShape<TLBookmarkShape>({ id: shape.id, type: 'bookmark', props: { url } })
	}

	const refetch = async () => {
		commitAddress()
		const url = parseTypedUrl(address)
		if (!url) return
		setFetching(true)
		setStatus('')
		// The page's own name and picture again, in place of anything chosen for this card.
		const now = current()
		if (now) editor.updateShape<TLBookmarkShape>({ id: now.id, type: 'bookmark', meta: editsMeta({}) })
		const read = await fillBookmark(editor, shape.id, { refresh: true })
		setFetching(false)
		setStatus(read ? `Read from ${linkDomain(url)}.` : 'The page couldn’t be read, so the card goes by its site. Name it here.')
	}

	const usePicture = async (blob: Blob) => {
		if (!PICTURE_TYPES.includes(blob.type)) {
			setStatus('Choose a picture: PNG, JPEG, WebP, GIF or AVIF.')
			return
		}
		setStatus('')
		try {
			const { blob: kept } = await downscaleImage(blob)
			const src = await getAssetBridge().store(kept)
			edit({ image: src, focus: undefined })
		} catch {
			setStatus('That picture couldn’t be read.')
		}
	}

	const pasteFromClipboard = async () => {
		try {
			for (const item of await navigator.clipboard.read()) {
				const type = item.types.find((t) => PICTURE_TYPES.includes(t))
				if (type) return void (await usePicture(await item.getType(type)))
			}
			setStatus('There’s no picture on the clipboard. Copy one first.')
		} catch {
			setStatus('Press ⌘V to paste a picture here.')
		}
	}

	const onPaste = (e: ClipboardEvent) => {
		const file = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'))
		// Text pastes into the field it's meant for; a picture is the card's, never a new shape.
		if (!file) return
		e.preventDefault()
		e.stopPropagation()
		void usePicture(file)
	}

	// Keys stay in the inspector, or arrows would nudge the card and letters pick tools. Escape closes.
	const onKeyDown = (e: KeyboardEvent) => {
		e.stopPropagation()
		if (e.key === 'Escape') {
			e.preventDefault()
			close()
		}
	}
	const blurOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === 'Enter') {
			e.preventDefault()
			e.currentTarget.blur()
		}
	}

	return (
		<div className="lb-linkinspector" role="dialog" aria-label="Link preview" onKeyDown={onKeyDown} onPaste={onPaste}>
			<div className="lb-linkinspector__head">
				<h2>Link preview</h2>
				<button type="button" className="lb-linkinspector__close" aria-label="Close" onClick={close}>
					<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
						<path d="M4 4l8 8M12 4l-8 8" />
					</svg>
				</button>
			</div>

			<label className="lb-linkinspector__field">
				<span className="lb-linkinspector__label">Title</span>
				<input
					ref={titleInput}
					className="lb-linkinspector__input"
					type="text"
					autoComplete="off"
					spellCheck={false}
					value={edits.title ?? content.title}
					placeholder={content.title}
					onChange={(e) => edit({ title: e.target.value })}
					onKeyDown={blurOnEnter}
				/>
			</label>

			<div className="lb-linkinspector__field">
				<label className="lb-linkinspector__label" htmlFor={`lb-linkinspector-url-${shape.id}`}>
					URL
				</label>
				<input
					id={`lb-linkinspector-url-${shape.id}`}
					className="lb-linkinspector__input"
					type="url"
					inputMode="url"
					autoComplete="off"
					spellCheck={false}
					aria-invalid={addressError ? 'true' : 'false'}
					value={address}
					onChange={(e) => setAddress(e.target.value)}
					onBlur={commitAddress}
					onKeyDown={blurOnEnter}
				/>
				{addressError && <p className="lb-linkinspector__error">{addressError}</p>}
				<div className="lb-linkinspector__meta">
					<span>{content.domain ? `Shown as ${content.domain}` : 'No valid address'}</span>
					<button type="button" className="lb-linkinspector__linkbtn" disabled={fetching} onClick={() => void refetch()}>
						{fetching ? 'Fetching…' : 'Refetch preview'}
					</button>
				</div>
			</div>

			<div className="lb-linkinspector__field">
				<span className="lb-linkinspector__label">Image</span>
				<div className="lb-linkinspector__thumbframe">
					{image && imageSize ? (
						<FocusPicker
							image={image}
							size={imageSize}
							focus={content.focus}
							onFocus={(focus) => edit({ focus })}
						/>
					) : (
						<p className="lb-linkinspector__empty">
							{image ? 'Loading the picture…' : 'No picture. The card shows the site’s icon.'}
						</p>
					)}
				</div>
				{image && imageSize && <p className="lb-linkinspector__help">Click or drag on the picture to choose what the square shows.</p>}
				<div className="lb-linkinspector__buttons">
					<button type="button" className="lb-linkinspector__btn" onClick={() => fileInput.current?.click()}>
						Upload
					</button>
					<button type="button" className="lb-linkinspector__btn" onClick={() => void pasteFromClipboard()}>
						Paste
					</button>
					{edits.image && (
						<button type="button" className="lb-linkinspector__btn" onClick={() => edit({ image: undefined, focus: undefined })}>
							{content.pageImage ? 'Use the page’s' : 'Remove'}
						</button>
					)}
				</div>
				<input
					ref={fileInput}
					type="file"
					accept={PICTURE_TYPES.join(',')}
					hidden
					onChange={(e) => {
						const file = e.target.files?.[0]
						e.target.value = ''
						if (file) void usePicture(file)
					}}
				/>
			</div>

			{status && (
				<p className="lb-linkinspector__status" role="status">
					{status}
				</p>
			)}
		</div>
	)
}

/** The picture whole, the square's part of it outlined, and a dot on the point it's centred on. */
function FocusPicker({
	image,
	size,
	focus,
	onFocus,
}: {
	image: string
	size: { w: number; h: number }
	focus: [number, number]
	onFocus: (focus: [number, number]) => void
}) {
	const dragging = useRef(false)
	const crop = cropWindow(focus, size.w, size.h)
	const ratio = size.w / size.h
	const at = (e: PointerEvent<HTMLDivElement>) => {
		const box = e.currentTarget.getBoundingClientRect()
		const clamp = (n: number) => Math.min(1, Math.max(0, n))
		onFocus([clamp((e.clientX - box.left) / box.width), clamp((e.clientY - box.top) / box.height)])
	}
	const percent = (n: number) => `${n * 100}%`

	return (
		<div
			className="lb-linkinspector__thumb"
			role="slider"
			tabIndex={0}
			aria-label="What the square shows"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.round((ratio >= 1 ? focus[0] : focus[1]) * 100)}
			style={{ aspectRatio: `${size.w} / ${size.h}`, width: `min(100%, ${Math.round(176 * ratio)}px)` }}
			onPointerDown={(e) => {
				if (e.button !== 0) return
				dragging.current = true
				e.currentTarget.setPointerCapture(e.pointerId)
				at(e)
			}}
			onPointerMove={(e) => dragging.current && at(e)}
			onPointerUp={() => (dragging.current = false)}
			onPointerCancel={() => (dragging.current = false)}
			onKeyDown={(e) => {
				const step = e.shiftKey ? 0.1 : 0.05
				const move = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as Record<string, [number, number]>)[e.key]
				if (!move) return
				e.preventDefault()
				const clamp = (n: number) => Math.min(1, Math.max(0, n))
				onFocus([clamp(focus[0] + move[0]), clamp(focus[1] + move[1])])
			}}
		>
			<img src={image} alt="" draggable={false} />
			<div
				className="lb-linkinspector__crop"
				style={{ left: percent(crop.left), top: percent(crop.top), width: percent(crop.width), height: percent(crop.height) }}
			/>
			<div className="lb-linkinspector__dot" style={{ left: percent(focus[0]), top: percent(focus[1]) }} />
		</div>
	)
}
