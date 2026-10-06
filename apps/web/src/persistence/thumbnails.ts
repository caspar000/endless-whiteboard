import type { Editor } from '@lifeboard/canvas'
import type { ResolvedTheme } from '../app/useTheme'
import type { KvStore } from '../platform/PlatformAdapter'

/**
 * Board thumbnails — the previews on the home screen's cards.
 *
 * Generated from the live editor at the moment you ask to leave a board — *before* anything starts
 * tearing down. Boards that have no preview in the theme on screen are drawn by the home screen in a
 * hidden editor (canvas/ThumbnailBackfill.tsx), through the same function.
 *
 * The timing is load-bearing. This used to run from the editor's unmount cleanup, by which point the
 * board host is `visibility: hidden` for the persistence drain — and tldraw's exporter produced an
 * image with every node's background and font missing, so previews visibly degraded to serif text a
 * second after looking right. Capture while the board is still on screen.
 *
 * Stored as Blobs in the KV store under their own keys rather than inside the board index, so listing
 * boards stays a single small read and never drags a megabyte of images with it.
 *
 * One per board and theme, since a preview bakes in the theme it was drawn in. Only the latest drawing
 * is kept: drawing one theme drops the other's, which is out of date from then on, and the home screen
 * draws it again when it is next needed (canvas/ThumbnailBackfill.tsx).
 */
const PREFIX = 'thumb:'
const THEMES: readonly ResolvedTheme[] = ['light', 'dark']
const key = (boardId: string, theme: ResolvedTheme) => `${PREFIX}${theme}:${boardId}`

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

/**
 * Called with each preview this browser draws (not ones it was sent), so the app can pass a server
 * board's on to the server for every other device.
 */
type DrawnListener = (boardId: string, theme: ResolvedTheme, blob: Blob) => void
const drawnListeners = new Set<DrawnListener>()

export function onThumbnailDrawn(listener: DrawnListener): () => void {
	drawnListeners.add(listener)
	return () => drawnListeners.delete(listener)
}

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

		const theme = editor.user.getIsDarkMode() ? 'dark' : 'light'
		await storeBoardThumbnail(kv, boardId, theme, result.blob)
		for (const listener of drawnListeners) listener(boardId, theme, result.blob)
	} catch (err) {
		// A thumbnail is decoration. Failing to make one must never block leaving a board or, worse,
		// interrupt the persistence flush happening at the same moment.
		console.warn('Lifeboard: could not generate board thumbnail', err)
	}
}

export async function loadBoardThumbnail(
	kv: KvStore,
	boardId: string,
	theme: ResolvedTheme
): Promise<Blob | undefined> {
	const blob = await kv.get<Blob>(key(boardId, theme))
	// Guard the type: this key survives app upgrades, and a non-Blob would break `createObjectURL`.
	return blob instanceof Blob ? blob : undefined
}

/** Keeps a board's latest preview, drawn here or by another device, and drops the other theme's. */
export async function storeBoardThumbnail(
	kv: KvStore,
	boardId: string,
	theme: ResolvedTheme,
	blob: Blob
): Promise<void> {
	await kv.set(key(boardId, theme), blob)
	for (const other of THEMES) if (other !== theme) await kv.delete(key(boardId, other))
	notify(boardId)
}

export async function deleteBoardThumbnail(kv: KvStore, boardId: string): Promise<void> {
	for (const theme of THEMES) await kv.delete(key(boardId, theme))
}

/** Drops previews stored before they had a theme (`thumb:<id>`): nothing says which theme they are in. */
export async function forgetUnthemedThumbnails(kv: KvStore): Promise<void> {
	const themed = THEMES.map((theme) => `${PREFIX}${theme}:`)
	for (const stored of await kv.keys()) {
		if (stored.startsWith(PREFIX) && !themed.some((prefix) => stored.startsWith(prefix))) await kv.delete(stored)
	}
}

function notify(boardId: string): void {
	for (const listener of listeners) listener(boardId)
}
