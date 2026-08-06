import type { Editor } from 'tldraw'
import type { KvStore } from '../platform/PlatformAdapter'

/**
 * Board thumbnails — the previews on the home screen's cards.
 *
 * Generated from the live editor at the moment you ask to leave a board — *before* anything starts
 * tearing down. No background worker and no re-opening boards to render them: the plan deferred
 * "thumbnail workers" as over-engineering, and this needs none.
 *
 * The timing is load-bearing. This used to run from the editor's unmount cleanup, by which point the
 * board host is `visibility: hidden` for the persistence drain — and tldraw's exporter produced an
 * image with every node's background and font missing, so previews visibly degraded to serif text a
 * second after looking right. Capture while the board is still on screen.
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

/**
 * Lets a board that is currently hidden be exported anyway.
 *
 * An inactive mounted board is hidden with `visibility: hidden` (see `.lb-board-host[data-hidden]`),
 * and tldraw's exporter honours that: every HTML-backed shape — which is every node type — serialises
 * to nothing, so the image comes out blank. Measured: 23 KB of empty paper against 119 KB for the same
 * board visible.
 *
 * `data-exporting` swaps that for a clip, which hides the board just as completely but leaves the
 * shapes' own computed styles alone. Verified byte-identical to exporting a fully visible board.
 *
 * The attribute is removed again in a `finally`, so a failed export can't leave a board clipped.
 */
async function withExportableHost<T>(editor: Editor, run: () => Promise<T>): Promise<T> {
	const host = editor.getContainer().closest<HTMLElement>('[data-hidden]')
	if (!host) return run()

	host.setAttribute('data-exporting', 'true')
	try {
		await nextPaint()
		return await run()
	} finally {
		host.removeAttribute('data-exporting')
	}
}

/**
 * Two frames, because the export reads computed styles: one for the attribute above to take effect,
 * one for the resulting style recalculation to land. Bounded by a timer as well — `requestAnimationFrame`
 * never fires in a background tab, and an OS theme flip can arrive while the app is not on screen.
 */
function nextPaint(): Promise<void> {
	return new Promise((resolve) => {
		const done = () => resolve()
		requestAnimationFrame(() => requestAnimationFrame(done))
		setTimeout(done, 100)
	})
}

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

		const result = await withExportableHost(editor, () =>
			editor.toImage(shapes, {
				format: 'webp',
				quality: 0.7,
				background: true,
				// Exported in the app's own theme, so a preview looks like the board you left — matching the
				// app is what Freeform does. (An earlier version forced light mode to make previews legible,
				// but that was compensating for a broken export that dropped the node card backgrounds
				// entirely. With the cards rendering, either theme reads fine on its own terms.) Read from
				// the editor rather than passed in: it already resolves `system` against the OS.
				darkMode: editor.user.getIsDarkMode(),
				padding: 32,
				// Clamped: a board whose content is tiny would otherwise be upscaled enormously.
				scale: Math.min(scale, 2),
			})
		)

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

/**
 * Drops cached thumbnails for every board except those listed, for when the theme changes.
 *
 * A thumbnail bakes in the theme it was exported in, so after a switch the survivors would be a mix of
 * light and dark previews — and the well behind a letterboxed image (`--lb-thumb-paper`) would frame a
 * dark picture in light. The keep-list is the boards that were just re-exported; the rest are dropped
 * because they have no mounted editor to export *from*, and a placeholder is at least honest. They come
 * back the next time each board is opened and left.
 */
export async function clearThumbnailsExcept(kv: KvStore, keepIds: string[]): Promise<void> {
	const keep = new Set(keepIds.map((id) => `${PREFIX}${id}`))
	const keys = (await kv.keys()).filter((key) => key.startsWith(PREFIX) && !keep.has(key))
	for (const key of keys) {
		await kv.delete(key)
		// Notify per board so cards already on screen swap to the placeholder now, rather than staying
		// on a stale preview until the next full reload.
		notify(key.slice(PREFIX.length))
	}
}

function notify(boardId: string): void {
	for (const listener of listeners) listener(boardId)
}
