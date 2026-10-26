import type { Editor } from '@lifeboard/canvas'
import type { ResolvedTheme } from '../app/useTheme'
import type { KvStore } from '../platform/PlatformAdapter'
import type { BoardMeta } from '../boards/boardIndex'
import { serverPreviewVersion } from '../server/serverVault'

/**
 * Board thumbnails — the previews on the home screen's cards.
 *
 * Drawn from the live editor of a board that is off screen and has changed since its last preview,
 * while the user is idle (app/App.tsx). Not on the way out of a board: an export of a couple of hundred
 * notes blocks the page for ~400 ms, and awaiting it made every tab switch lag by that much. Boards
 * with no live editor and no current preview are drawn by the home screen in a hidden editor
 * (canvas/ThumbnailBackfill.tsx), through the same function.
 *
 * Exporting a hidden board is safe only because of `withExportableHost` below. Without it, tldraw's
 * exporter dropped every node's background and font from a `visibility: hidden` board, and previews
 * degraded to serif text.
 *
 * Stored as Blobs in the KV store under their own keys rather than inside the board index, so listing
 * boards stays a single small read and never drags a megabyte of images with it.
 *
 * One per board and theme, since a preview bakes in the theme it was drawn in. Both are drawn at once
 * (`inTheme`), so switching theme only swaps the pictures the cards show.
 */
const PREFIX = 'thumb:'
export const THEMES: readonly ResolvedTheme[] = ['light', 'dark']
const key = (boardId: string, theme: ResolvedTheme) => `${PREFIX}${theme}:${boardId}`
/** When the preview under `key` was stored, by this browser's clock: compared with a local board's `updatedAt`. */
const drawnAtKey = (boardId: string, theme: ResolvedTheme) => `thumbAt:${theme}:${boardId}`

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
/**
 * At most this many shapes go into a preview. Exporting costs by the shape (400 notes took ~950 ms of
 * blocked page, 120 took ~290 ms), and at a card's size the rest are specks.
 */
const MAX_SHAPES = 120

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
 * Draws a hidden board in `theme` for the length of `run`, whatever the app shows: the canvas through
 * the editor's own dark-mode override, which no other editor sees, and the app's colours through
 * `data-lb-theme` on its container (styles.css), which node cards read. Hidden, so nobody sees it flip.
 */
async function inTheme<T>(editor: Editor, theme: ResolvedTheme, run: () => Promise<T>): Promise<T> {
	const dark = theme === 'dark'
	if (dark === editor.user.getIsDarkMode()) return run()
	const container = editor.getContainer()
	editor.user.setDarkModeOverride(dark)
	container.setAttribute('data-lb-theme', theme)
	try {
		// The shapes draw again in the other theme before their styles are read.
		await nextPaint()
		return await run()
	} finally {
		editor.user.setDarkModeOverride(null)
		container.removeAttribute('data-lb-theme')
	}
}

/** Whether the board is out of sight: a tab behind the one on screen, or the home screen's off-screen editor. */
const isHidden = (editor: Editor) => !!editor.getContainer().closest('[data-hidden], .lb-offscreen-board')

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

/** Editors whose preview has been drawn since the user last changed their board. */
const fresh = new WeakSet<Editor>()
const watched = new WeakSet<Editor>()

/**
 * Whether the board has changed since its preview was last drawn. An editor starts out stale until
 * `adoptStoredThumbnail` finds its stored preview current, so a board edited just before a reload is
 * still drawn. Only the user's own edits count; a remote edit is drawn by the device that made it.
 */
export function isThumbnailStale(editor: Editor): boolean {
	return !fresh.has(editor)
}

/**
 * Whether the board's stored preview in `theme` was drawn after its last edit: on the server's clock for
 * a server board, on this browser's for a local one, the clock its `updatedAt` is on.
 */
export async function isStoredThumbnailCurrent(kv: KvStore, board: BoardMeta, theme: ResolvedTheme): Promise<boolean> {
	if (board.vault === 'server') return (serverPreviewVersion(board, theme) ?? -Infinity) >= board.updatedAt
	const drawnAt = await kv.get<number>(drawnAtKey(board.id, theme))
	// The picture itself too: a time with no picture to go with it is not a preview.
	return typeof drawnAt === 'number' && drawnAt >= board.updatedAt && (await loadBoardThumbnail(kv, board.id, theme)) !== undefined
}

/** Whether the board's previews in both themes were drawn after its last edit. */
export async function areStoredThumbnailsCurrent(kv: KvStore, board: BoardMeta): Promise<boolean> {
	for (const theme of THEMES) if (!(await isStoredThumbnailCurrent(kv, board, theme))) return false
	return true
}

/**
 * Starts a newly mounted editor out fresh when the board's stored previews are current, so opening and
 * closing a board without changing it draws nothing. An edit made while the answer is on its way
 * keeps it stale.
 */
export async function adoptStoredThumbnail(editor: Editor, current: Promise<boolean>): Promise<void> {
	let edited = false
	const stop = editor.store.listen(() => (edited = true), { scope: 'document', source: 'user' })
	try {
		if ((await current) && !edited) markFresh(editor)
	} catch {
		// Stays stale: drawing again is the safe side.
	} finally {
		stop()
	}
}

function markFresh(editor: Editor) {
	if (!watched.has(editor)) {
		watched.add(editor)
		editor.store.listen(() => fresh.delete(editor), { scope: 'document', source: 'user' })
	}
	fresh.add(editor)
}

export async function saveBoardThumbnail(
	kv: KvStore,
	boardId: string,
	editor: Editor
): Promise<void> {
	// Before the export, so an edit made while it runs marks the board stale again. A failed export
	// stays marked too: the next edit retries it, rather than a broken board retrying forever.
	markFresh(editor)
	try {
		const shapeIds = [...editor.getCurrentPageShapeIds()]
		if (shapeIds.length === 0) {
			// An empty board should show the empty-state card, not a blank image.
			await deleteBoardThumbnail(kv, boardId)
			notifyThumbnailSaved(boardId)
			return
		}

		// A big board is drawn from its largest shapes: they are what makes it recognisable at a card's
		// size. The sort is stable, so shapes the same size keep their order and the choice is the same
		// from one export to the next.
		const shapes =
			shapeIds.length <= MAX_SHAPES
				? shapeIds
				: shapeIds
						.map((id) => {
							const box = editor.getShapePageBounds(id)
							return { id, area: box ? box.width * box.height : 0 }
						})
						.sort((a, b) => b.area - a.area)
						.slice(0, MAX_SHAPES)
						.map(({ id }) => id)

		const bounds = editor.getCurrentPageBounds()
		if (!bounds) return

		const scale = THUMB_LONG_EDGE / Math.max(bounds.width, bounds.height, 1)

		// In each theme, so a preview looks like the board would in the theme on screen, whichever that
		// is: the one showing first, the other only for a hidden board, which can change theme unseen.
		const showing: ResolvedTheme = editor.user.getIsDarkMode() ? 'dark' : 'light'
		const themes = isHidden(editor) ? [showing, ...THEMES.filter((theme) => theme !== showing)] : [showing]
		await withExportableHost(editor, async () => {
			for (const theme of themes) {
				const result = await inTheme(editor, theme, () =>
					editor.toImage(shapes, {
						format: 'webp',
						quality: 0.7,
						background: true,
						padding: 32,
						// Clamped: a board whose content is tiny would otherwise be upscaled enormously.
						scale: Math.min(scale, 2),
					})
				)
				await storeBoardThumbnail(kv, boardId, theme, result.blob)
				for (const listener of drawnListeners) listener(boardId, theme, result.blob)
			}
		})
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

/**
 * Object URLs of the previews this tab has read or drawn, by KV key, with the board's `updatedAt` each
 * was read for. They outlive the home screen, which unmounts whenever a board opens, so going back to
 * it shows every preview on its first frame instead of the placeholder while IndexedDB answers. Kept
 * for the session: one small image per board, the same ones the grid shows anyway.
 */
const urls = new Map<string, { url: string; readFor: number }>()

function cacheUrl(storedKey: string, blob: Blob | undefined, readFor: number): void {
	const old = urls.get(storedKey)
	// An `<img>` that has already loaded the old address keeps its picture after the revoke.
	if (old) URL.revokeObjectURL(old.url)
	if (blob) urls.set(storedKey, { url: URL.createObjectURL(blob), readFor })
	else urls.delete(storedKey)
}

/** The preview this tab last saw for the board, at once, or `undefined` if it has seen none. */
export function peekBoardThumbnailUrl(boardId: string, theme: ResolvedTheme): string | undefined {
	return urls.get(key(boardId, theme))?.url
}

/**
 * The board's stored preview as an object URL. Read again only when the board has changed since it was
 * last read (`updatedAt`), which is how a preview drawn in another tab reaches this one.
 */
export async function loadBoardThumbnailUrl(
	kv: KvStore,
	boardId: string,
	theme: ResolvedTheme,
	updatedAt: number
): Promise<string | undefined> {
	const storedKey = key(boardId, theme)
	const cached = urls.get(storedKey)
	if (cached && cached.readFor >= updatedAt) return cached.url
	cacheUrl(storedKey, await loadBoardThumbnail(kv, boardId, theme), updatedAt)
	return urls.get(storedKey)?.url
}

/** Keeps a board's latest preview in one theme, drawn here or by another device. */
export async function storeBoardThumbnail(
	kv: KvStore,
	boardId: string,
	theme: ResolvedTheme,
	blob: Blob
): Promise<void> {
	await kv.set(key(boardId, theme), blob)
	await kv.set(drawnAtKey(boardId, theme), Date.now())
	cacheUrl(key(boardId, theme), blob, Date.now())
	notifyThumbnailSaved(boardId)
}

export async function deleteBoardThumbnail(kv: KvStore, boardId: string): Promise<void> {
	for (const theme of THEMES) await forget(kv, boardId, theme)
}

async function forget(kv: KvStore, boardId: string, theme: ResolvedTheme): Promise<void> {
	await kv.delete(key(boardId, theme))
	await kv.delete(drawnAtKey(boardId, theme))
	cacheUrl(key(boardId, theme), undefined, 0)
}

/** Drops previews stored before they had a theme (`thumb:<id>`): nothing says which theme they are in. */
export async function forgetUnthemedThumbnails(kv: KvStore): Promise<void> {
	const themed = THEMES.map((theme) => `${PREFIX}${theme}:`)
	for (const stored of await kv.keys()) {
		if (stored.startsWith(PREFIX) && !themed.some((prefix) => stored.startsWith(prefix))) await kv.delete(stored)
	}
}

/** Also called once a server board's new preview is on the server, so its card asks for the new version. */
export function notifyThumbnailSaved(boardId: string): void {
	for (const listener of listeners) listener(boardId)
}
