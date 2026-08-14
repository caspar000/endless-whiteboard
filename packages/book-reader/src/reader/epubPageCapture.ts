import type { SnapdomOptions } from '@zumer/snapdom'
import {
	paintPage,
	visibleWindow,
	type PaintedPage,
	type PaintPageOptions,
	type PaintWindow,
} from './paintPage'

/** Capture work is speculative; a broken resource must never make a page turn wait indefinitely. */
const RESOURCE_SETTLE_MS = 500
const ATOMIC_CAPTURE_TIMEOUT_MS = 1_500
const ATOMIC_CAPTURE_CONCURRENCY = 4
const MAX_ATOMIC_CAPTURES = 24
const MAX_ATOMIC_PIXELS = 6_000_000
/** Eight million RGBA pixels cap temporary atomic canvases at roughly 31 MiB per prepared page. */
const MAX_ATOMIC_TOTAL_PIXELS = 8_000_000
const ATOMIC_SELECTOR = 'img, svg, canvas, video, math, figure, table, object, embed'

interface CaptureSource {
	doc: Document
	/** Page-coordinate rectangle handed to SnapDOM. */
	clip: { x: number; y: number; width: number; height: number }
	/** Where that clipped result belongs on the reader's sheet. */
	paste: PaintWindow
	/** The same rectangle in the iframe viewport, for deciding which images need decoding. */
	viewport: PaintWindow
}

export interface EpubPageCaptureTarget {
	key: string
	docs: readonly Document[]
	sources: readonly CaptureSource[]
	width: number
	height: number
	dpr: number
	paper: string
	ownerDocument: Document
}

type ToCanvas = (element: Element, options?: SnapdomOptions) => Promise<HTMLCanvasElement>
type Paint = (
	doc: Document,
	width: number,
	height: number,
	paper: string,
	offset: { x: number; y: number },
	clip?: PaintWindow | null,
	options?: PaintPageOptions
) => PaintedPage | null

interface AtomicCapture {
	element: Element
	canvas: HTMLCanvasElement
	rect: DOMRect
}

export interface EpubPageCaptureCache {
	get(target: EpubPageCaptureTarget): PaintedPage | undefined
	put(target: EpubPageCaptureTarget, page: PaintedPage): void
	clear(): void
}

/**
 * One prepared texture is enough: after a relocation the old one is unusable and the new current
 * page is the only sheet a turn can leave. Keeping this deliberately tiny also bounds pixel memory.
 */
export function createEpubPageCaptureCache(): EpubPageCaptureCache {
	let current:
		| { key: string; docs: readonly Document[]; page: PaintedPage }
		| undefined

	return {
		get(target) {
			if (
				current?.key !== target.key ||
				current.docs.length !== target.docs.length ||
				current.docs.some((doc, index) => doc !== target.docs[index])
			) {
				return undefined
			}
			return current.page
		},
		put(target, page) {
			current = { key: target.key, docs: [...target.docs], page }
		},
		clear() {
			current = undefined
		},
	}
}

/**
 * Measures every mounted Foliate section that contributes pixels to the visible sheet.
 *
 * Most turns have one document. At a chapter boundary Foliate may show two section iframes in the
 * same spread; treating them as separate clipped sources prevents the second half becoming blank.
 */
export function epubPageCaptureTarget(
	docs: readonly Document[],
	frame: HTMLElement,
	paper: string
): EpubPageCaptureTarget | null {
	const box = frame.getBoundingClientRect()
	if (box.width < 2 || box.height < 2) return null

	const sources: CaptureSource[] = []
	for (const doc of docs) {
		const view = doc.defaultView
		const iframe = view?.frameElement
		const visible = visibleWindow(doc, frame)
		if (!view || !iframe || !visible) continue
		const inner = iframe.getBoundingClientRect()
		const offset = { x: inner.left - box.left, y: inner.top - box.top }
		const viewport = {
			left: visible.left - offset.x,
			top: visible.top - offset.y,
			right: visible.right - offset.x,
			bottom: visible.bottom - offset.y,
		}
		sources.push({
			doc,
			clip: {
				x: viewport.left + view.scrollX,
				y: viewport.top + view.scrollY,
				width: visible.right - visible.left,
				height: visible.bottom - visible.top,
			},
			paste: visible,
			viewport,
		})
	}
	if (!sources.length) return null

	const dpr = Math.min(2, frame.ownerDocument.defaultView?.devicePixelRatio || 1)
	const key = [
		paper,
		fixed(box.width),
		fixed(box.height),
		fixed(dpr),
		...sources.flatMap(({ clip, paste }) => [
			fixed(clip.x),
			fixed(clip.y),
			fixed(clip.width),
			fixed(clip.height),
			fixed(paste.left),
			fixed(paste.top),
		]),
	].join('|')

	return {
		key,
		docs: sources.map(({ doc }) => doc),
		sources,
		width: box.width,
		height: box.height,
		dpr,
		paper,
		ownerDocument: frame.ownerDocument,
	}
}

/**
 * Builds one outgoing sheet without asking a cloned document to paginate prose a second time.
 *
 * Text and ordinary fallback images come from `paintPage`, whose coordinates are read from the live
 * Foliate layout. SnapDOM is confined to small atomic visuals: an image, SVG, figure, table, maths,
 * canvas or video. Those elements cannot move the surrounding column break when cloned alone.
 */
export async function captureEpubPage(
	target: EpubPageCaptureTarget,
	toCanvas?: ToCanvas,
	paint: Paint = paintPage
): Promise<PaintedPage | null> {
	const texture = target.ownerDocument.createElement('canvas')
	texture.width = Math.ceil(target.width * target.dpr)
	texture.height = Math.ceil(target.height * target.dpr)
	const ctx = texture.getContext('2d')
	if (!ctx) return null
	ctx.scale(target.dpr, target.dpr)
	ctx.fillStyle = target.paper
	ctx.fillRect(0, 0, target.width, target.height)

	let painted = false
	let loadedCapture = toCanvas
	const getCapture = async () => {
		loadedCapture ??= (await import('@zumer/snapdom')).snapdom.toCanvas
		return loadedCapture
	}

	for (const source of target.sources) {
		await settleVisibleResources(source)
		const atomic = await captureAtomicVisuals(source, target.dpr, getCapture)
		const offset = {
			x: source.paste.left - source.viewport.left,
			y: source.paste.top - source.viewport.top,
		}

		// Atomic captures are placed first. Live-positioned prose then remains crisp and wins normal
		// document-order overlaps; captured descendants are omitted so captions and SVG text do not blur.
		for (const visual of atomic) drawAtomic(ctx, visual, source, offset)
		const layer = paint(
			source.doc,
			target.width,
			target.height,
			target.paper,
			offset,
			source.paste,
			{ fillPaper: false, omit: new Set(atomic.map(({ element }) => element)) }
		)
		if (!layer) continue
		ctx.drawImage(layer.texture, 0, 0, target.width, target.height)
		painted = true
	}

	return painted ? { texture, width: target.width, height: target.height } : null
}

async function captureAtomicVisuals(
	source: CaptureSource,
	dpr: number,
	getCapture: () => Promise<ToCanvas>
): Promise<AtomicCapture[]> {
	const candidates: { element: Element; rect: DOMRect }[] = []
	let reservedPixels = 0
	for (const element of source.doc.querySelectorAll(ATOMIC_SELECTOR)) {
		if (candidates.some(({ element: parent }) => parent.contains(element))) continue
		const rect = element.getBoundingClientRect()
		const pixels = atomicPixels(rect, dpr)
		if (
			!intersects(rect, source.viewport) ||
			!boundedAtomic(rect, source, pixels) ||
			reservedPixels + pixels > MAX_ATOMIC_TOTAL_PIXELS
		) {
			continue
		}
		candidates.push({ element, rect })
		reservedPixels += pixels
		if (candidates.length >= MAX_ATOMIC_CAPTURES) break
	}
	if (!candidates.length) return []

	const capture = await getCapture()
	const captured: AtomicCapture[] = []
	for (let start = 0; start < candidates.length; start += ATOMIC_CAPTURE_CONCURRENCY) {
		const batch = candidates.slice(start, start + ATOMIC_CAPTURE_CONCURRENCY)
		const results = await Promise.all(
			batch.map(async ({ element, rect }) => {
				try {
					const canvas = await within(
						capture(element, {
							dpr,
							scale: 1,
							backgroundColor: 'transparent',
							embedFonts: true,
							reconcile: true,
							cache: 'auto',
							outerTransforms: true,
							outerShadows: false,
							resolvePicturePlaceholders: false,
							useProxy: '',
							placeholders: true,
						}),
						ATOMIC_CAPTURE_TIMEOUT_MS
					)
					return canvas ? { element, canvas, rect } : null
				} catch {
					return null
				}
			})
		)
		for (const result of results) if (result) captured.push(result)
	}
	return captured
}

function atomicPixels(rect: DOMRect, dpr: number): number {
	return Math.ceil(rect.width * dpr) * Math.ceil(rect.height * dpr)
}

function boundedAtomic(rect: DOMRect, source: CaptureSource, pixels: number): boolean {
	const pageWidth = source.viewport.right - source.viewport.left
	const pageHeight = source.viewport.bottom - source.viewport.top
	return (
		rect.width >= 1 &&
		rect.height >= 1 &&
		rect.width <= pageWidth + 1 &&
		rect.height <= pageHeight + 1 &&
		pixels <= MAX_ATOMIC_PIXELS
	)
}

function drawAtomic(
	ctx: CanvasRenderingContext2D,
	visual: AtomicCapture,
	source: CaptureSource,
	offset: { x: number; y: number }
): void {
	const page = {
		left: visual.rect.left + offset.x,
		top: visual.rect.top + offset.y,
		right: visual.rect.right + offset.x,
		bottom: visual.rect.bottom + offset.y,
	}
	const visible = {
		left: Math.max(page.left, source.paste.left),
		top: Math.max(page.top, source.paste.top),
		right: Math.min(page.right, source.paste.right),
		bottom: Math.min(page.bottom, source.paste.bottom),
	}
	if (visible.right <= visible.left || visible.bottom <= visible.top) return

	const scaleX = visual.canvas.width / visual.rect.width
	const scaleY = visual.canvas.height / visual.rect.height
	ctx.drawImage(
		visual.canvas,
		(visible.left - page.left) * scaleX,
		(visible.top - page.top) * scaleY,
		(visible.right - visible.left) * scaleX,
		(visible.bottom - visible.top) * scaleY,
		visible.left,
		visible.top,
		visible.right - visible.left,
		visible.bottom - visible.top
	)
}

/** Waits briefly for only the resources which can contribute pixels to this clipped page. */
async function settleVisibleResources(source: CaptureSource): Promise<void> {
	const images = [...source.doc.images].filter((image) => intersects(image.getBoundingClientRect(), source.viewport))
	const decoded = Promise.allSettled(
		images.map((image) => {
			if (image.complete) return Promise.resolve()
			return typeof image.decode === 'function' ? image.decode() : Promise.resolve()
		})
	)
	await within(Promise.allSettled([source.doc.fonts?.ready ?? Promise.resolve(), decoded]), RESOURCE_SETTLE_MS)
}

function intersects(rect: DOMRect, window: PaintWindow): boolean {
	return (
		rect.right > window.left &&
		rect.left < window.right &&
		rect.bottom > window.top &&
		rect.top < window.bottom
	)
}

async function within<T>(promise: Promise<T>, milliseconds: number): Promise<T | undefined> {
	let cancelTimer: (() => void) | undefined
	try {
		return await Promise.race([
			promise,
			new Promise<undefined>((resolve) => {
				const timer = setTimeout(resolve, milliseconds)
				cancelTimer = () => clearTimeout(timer)
			}),
		])
	} finally {
		cancelTimer?.()
	}
}

/** Stable enough to reject a cached sheet after a sub-pixel layout move, without float noise. */
function fixed(value: number): string {
	return value.toFixed(2)
}
