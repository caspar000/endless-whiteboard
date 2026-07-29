import type { Editor } from 'tldraw'
import type { KvStore } from '../platform/PlatformAdapter'

/**
 * Board thumbnails — the previews on the home screen's cards.
 *
 * Generated from the live editor when you leave a board, which is the one moment we already have a
 * mounted editor for that board (see `DRAIN_MS` in app/App.tsx). No background worker, no re-opening
 * boards to render them: the plan deferred "thumbnail workers" as over-engineering, and this needs
 * none.
 *
 * Stored as Blobs in the KV store under their own keys rather than inside the board index, so listing
 * boards stays a single small read and never drags a megabyte of images with it.
 */
const PREFIX = 'thumb:'

/**
 * Notification that a board's thumbnail has been (re)written.
 *
 * Needed because the write finishes *after* the home screen has already rendered: the thumbnail is
 * captured as the board unmounts, by which point the card for it is on screen showing the previous
 * preview (or the placeholder). Without this signal the card kept showing that stale image until the
 * next full reload — the preview would be permanently one edit behind.
 */
type ThumbnailListener = (boardId: string) => void
const listeners = new Set<ThumbnailListener>()

export function onThumbnailSaved(listener: ThumbnailListener): () => void {
	listeners.add(listener)
	return () => listeners.delete(listener)
}

/** Long edge in device pixels. Cards are ~260px wide, so this stays crisp on a 2× display. */
const THUMB_LONG_EDGE = 600
const MAX_SHAPES = 400

export async function saveBoardThumbnail(
	kv: KvStore,
	boardId: string,
	editor: Editor
): Promise<void> {
	try {
		const shapeIds = [...editor.getCurrentPageShapeIds()]
		if (shapeIds.length === 0) {
			// An empty board should show the empty-state card, not a blank image.
			await deleteBoardThumbnail(kv, boardId)
			notify(boardId)
			return
		}

		// Exporting a very large board is slow and the result is illegible anyway; a subset still
		// reads as "this is that board". Ordering by index keeps the choice stable between exports.
		const shapes = shapeIds.slice(0, MAX_SHAPES)

		const bounds = editor.getCurrentPageBounds()
		if (!bounds) return

		const scale = THUMB_LONG_EDGE / Math.max(bounds.width, bounds.height, 1)

		const result = await editor.toImage(shapes, {
			format: 'webp',
			quality: 0.7,
			background: true,
			// Exported light, even though the app is dark. Node components are styled dark in CSS, so a
			// dark export is dark-on-dark and the preview reads as an almost-black rectangle. On light
			// paper the same cards stand out — which is exactly why Freeform's thumbnails are legible at
			// card size.
			darkMode: false,
			padding: 32,
			// Clamped: a board whose content is tiny would otherwise be upscaled enormously.
			scale: Math.min(scale, 2),
		})

		await kv.set(`${PREFIX}${boardId}`, result.blob)
		notify(boardId)
	} catch (err) {
		// A thumbnail is decoration. Failing to make one must never block leaving a board or, worse,
		// interrupt the persistence flush happening at the same moment.
		console.warn('Lifeboard: could not generate board thumbnail', err)
	}
}

export async function loadBoardThumbnail(kv: KvStore, boardId: string): Promise<Blob | undefined> {
	const blob = await kv.get<Blob>(`${PREFIX}${boardId}`)
	// Guard the type: this key survives app upgrades, and a non-Blob would break `createObjectURL`.
	return blob instanceof Blob ? blob : undefined
}

export async function deleteBoardThumbnail(kv: KvStore, boardId: string): Promise<void> {
	await kv.delete(`${PREFIX}${boardId}`)
}

function notify(boardId: string): void {
	for (const listener of listeners) listener(boardId)
}
