import type { PDFDocumentProxy } from 'pdfjs-dist'

/**
 * Pages kept ready, so a turn never waits for one to be drawn.
 *
 * Rasterizing a PDF page takes tens of milliseconds — invisible when you are sitting still, and
 * exactly the wrong moment when a page is turning: the sheet curls away to reveal a blank, which
 * arrives a beat later. The animation was never the stutter; the page underneath it was.
 *
 * So pages near the one you are on are drawn ahead of time, while nothing else is happening, and
 * kept as finished rasters. Turning then costs a `drawImage`.
 *
 * The bound is *pixels*, not pages, because a page is not a fixed size: the same ten pages are
 * 60MB at a paperback width and 180MB zoomed in, and only one of those is acceptable. Least
 * recently used goes first, which for a reader is the page furthest behind you.
 */
const BUDGET_PIXELS = 24_000_000

export interface CachedPage {
	canvas: HTMLCanvasElement
	/** The height it occupies on screen, in CSS pixels. */
	cssHeight: number
	/** Height ÷ width of the page itself, for sizing placeholders. */
	aspect: number
}

export interface PageCache {
	get(pageNumber: number, width: number, scale: number): CachedPage | undefined
	put(pageNumber: number, width: number, scale: number, page: CachedPage): void
	has(pageNumber: number, width: number, scale: number): boolean
	clear(): void
	/** How many pixels are currently held, for tests and for reasoning about memory. */
	size(): number
}

/**
 * A cache per open document, so nothing has to be keyed by which book it came from and the whole
 * thing is collected when the reader closes.
 */
export function createPageCache(): PageCache {
	// Insertion order *is* the LRU order: a hit deletes and re-inserts, moving it to the end.
	const pages = new Map<string, CachedPage>()
	let pixels = 0

	const cost = (page: CachedPage) => page.canvas.width * page.canvas.height

	return {
		get(pageNumber, width, scale) {
			const key = keyFor(pageNumber, width, scale)
			const found = pages.get(key)
			if (!found) return undefined
			pages.delete(key)
			pages.set(key, found)
			return found
		},
		has(pageNumber, width, scale) {
			return pages.has(keyFor(pageNumber, width, scale))
		},
		put(pageNumber, width, scale, page) {
			const key = keyFor(pageNumber, width, scale)
			const existing = pages.get(key)
			if (existing) pixels -= cost(existing)
			pages.set(key, page)
			pixels += cost(page)
			for (const [oldest, value] of pages) {
				if (pixels <= BUDGET_PIXELS) break
				if (oldest === key) continue
				pages.delete(oldest)
				pixels -= cost(value)
			}
		},
		clear() {
			pages.clear()
			pixels = 0
		},
		size: () => pixels,
	}
}

/** Width and scale are part of the key: a raster drawn for another zoom is the wrong pixels. */
function keyFor(pageNumber: number, width: number, scale: number): string {
	return `${pageNumber}@${Math.round(width)}x${scale}`
}

/** Draws a page to a canvas of its own, away from anything on screen. */
export async function rasterize(
	doc: PDFDocumentProxy,
	pageNumber: number,
	width: number,
	scale: number
): Promise<CachedPage | null> {
	const page = await doc.getPage(pageNumber)
	const base = page.getViewport({ scale: 1 })
	const viewport = page.getViewport({ scale: (width / base.width) * scale })
	const canvas = document.createElement('canvas')
	canvas.width = Math.ceil(viewport.width)
	canvas.height = Math.ceil(viewport.height)
	const canvasContext = canvas.getContext('2d')
	if (!canvasContext) return null
	await page.render({ canvas, canvasContext, viewport }).promise
	return {
		canvas,
		cssHeight: Math.ceil(viewport.height / scale),
		aspect: base.height / base.width,
	}
}

/**
 * Fills the cache around the page you are on, one page at a time and only when the browser is idle.
 *
 * Order matters: nearest first, and the page *ahead* before the one behind, because that is the one
 * you are about to want. One at a time and idle-scheduled because this must never be the reason the
 * page you are actually looking at is slow to appear — a prefetch that competes with the visible
 * render has made the problem worse, not better.
 */
export function prefetchAround(
	cache: PageCache,
	doc: PDFDocumentProxy,
	options: { page: number; pageCount: number; radius: number; width: number; scale: number }
): () => void {
	const { page, pageCount, radius, width, scale } = options
	let cancelled = false
	let handle: number | undefined

	const wanted: number[] = []
	for (let distance = 1; distance <= radius; distance++) {
		for (const candidate of [page + distance, page - distance]) {
			if (candidate >= 1 && candidate <= pageCount) wanted.push(candidate)
		}
	}

	const idle = (run: () => void) => {
		// A little later than "as soon as possible": the page just turned to has to get there first.
		handle = window.setTimeout(run, 120)
	}

	const next = () => {
		if (cancelled) return
		const pageNumber = wanted.shift()
		if (pageNumber === undefined) return
		if (cache.has(pageNumber, width, scale)) {
			next()
			return
		}
		void rasterize(doc, pageNumber, width, scale)
			.then((rendered) => {
				if (cancelled || !rendered) return
				cache.put(pageNumber, width, scale, rendered)
			})
			.catch(() => {
				// A page that will not draw is not worth stopping the queue for.
			})
			.finally(() => {
				if (!cancelled) idle(next)
			})
	}

	idle(next)
	return () => {
		cancelled = true
		if (handle !== undefined) clearTimeout(handle)
	}
}
