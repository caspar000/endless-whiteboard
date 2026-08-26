import { memo, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { loadPdfjs } from '../pdfjs'
import type { PageCache } from './pageCache'
import type { QuoteRect } from '../quote/rects'

/**
 * A rectangle over a page, in fractions of that page — resolution-independent, so the same numbers
 * describe the crop whether the page is on screen at 40% or being re-rendered at clip resolution.
 */
export interface AreaFraction {
	x: number
	y: number
	w: number
	h: number
}

/**
 * One rendered PDF page: raster, selectable text layer, and (in clip mode) a marquee.
 *
 * Every view mode renders this same component — one of them for a single page, two side by side for
 * a spread, a column of them for scrolling. That is the whole reason it exists: page-level concerns
 * (which page a selection is on, which page a crop came from) stay correct in every layout, because
 * there is only one implementation of "a page" and it knows its own number.
 */
export const PdfPage = memo(function PdfPage({
	doc,
	pageNumber,
	/** Width to render at, in CSS pixels. The height follows the page's own aspect ratio. */
	width,
	renderScale,
	cache,
	clipping,
	highlights,
	onClipArea,
	onHighlightClick,
	onRendered,
}: {
	doc: PDFDocumentProxy
	pageNumber: number
	width: number
	/** Pixels rendered per CSS pixel — the "Render quality" setting. */
	renderScale: number
	/** Pages drawn ahead of time. A hit here is the difference between a turn and a stutter. */
	cache?: PageCache
	clipping: boolean
	/** The quotes taken from this page, already decoded. */
	highlights: readonly { quoteId: string; rects: readonly QuoteRect[]; hue: number | null }[]
	onClipArea(pageNumber: number, area: AreaFraction): void
	onHighlightClick(quoteId: string): void
	/** Reports the rendered aspect ratio, so scroll-mode placeholders can stop guessing. */
	onRendered?(pageNumber: number, aspect: number): void
}) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null)
	const textLayerRef = useRef<HTMLDivElement | null>(null)
	const [marquee, setMarquee] = useState<AreaFraction | null>(null)
	const [height, setHeight] = useState<number | null>(null)

	const onRenderedRef = useRef(onRendered)
	onRenderedRef.current = onRendered

	/**
	 * A page drawn ahead of time, put on screen *before the browser paints* — which is the whole
	 * point. Waiting for the effect below would show one frame of blank canvas, and one frame of
	 * blank canvas at the end of a page turn is exactly the stutter this exists to remove.
	 */
	const ready = cache?.get(pageNumber, width, renderScale)
	useLayoutEffect(() => {
		const canvas = canvasRef.current
		if (!canvas || !ready) return
		canvas.width = ready.canvas.width
		canvas.height = ready.canvas.height
		canvas.style.width = `${width}px`
		canvas.style.height = `${ready.cssHeight}px`
		canvas.getContext('2d')?.drawImage(ready.canvas, 0, 0)
		setHeight(ready.cssHeight)
		onRenderedRef.current?.(pageNumber, ready.aspect)
	}, [ready, width, pageNumber])

	useEffect(() => {
		if (width <= 0) return
		let cancelled = false
		/*
		 * Held so the work can actually be *stopped*, not just ignored. Scrolling quickly past a page
		 * leaves its rasterization queued on the main thread; a flag alone would let every page you
		 * flew past keep painting, which is precisely what makes a fast scroll stutter.
		 */
		let renderTask: { cancel(): void } | null = null
		let textTask: { cancel(): void } | null = null
		void (async () => {
			try {
				const pdfjs = await loadPdfjs()
				const page = await doc.getPage(pageNumber)
				const canvas = canvasRef.current
				const textLayerEl = textLayerRef.current
				if (!canvas || !textLayerEl || cancelled) return

				const base = page.getViewport({ scale: 1 })
				const scale = width / base.width
				// The setting, not the screen: rendering above the display's own ratio supersamples,
				// which is what makes small type in a dense PDF legible.
				const dpr = renderScale
				const viewport = page.getViewport({ scale: scale * dpr })
				const cssHeight = Math.ceil(viewport.height / dpr)
				if (!cache?.has(pageNumber, width, renderScale)) {
					// Setting these clears the canvas, so it must not happen when the layout effect
					// above has already put a finished page there.
					canvas.width = Math.ceil(viewport.width)
					canvas.height = Math.ceil(viewport.height)
					canvas.style.width = `${width}px`
					canvas.style.height = `${cssHeight}px`
				}
				const canvasContext = canvas.getContext('2d')
				if (!canvasContext) return

				// Already drawn, and drawn at exactly this size — re-rendering would produce the same
				// pixels at the cost of the stall this cache exists to avoid.
				if (!cache?.has(pageNumber, width, renderScale)) {
					const task = page.render({ canvas, canvasContext, viewport })
					renderTask = task
					await task.promise
					if (cancelled) return
					setHeight(cssHeight)
					onRenderedRef.current?.(pageNumber, base.height / base.width)
					// Kept as a copy: this canvas belongs to an element that is about to be unmounted
					// and reused, and the cache must own pixels nobody else will draw over.
					const keep = document.createElement('canvas')
					keep.width = canvas.width
					keep.height = canvas.height
					keep.getContext('2d')?.drawImage(canvas, 0, 0)
					cache?.put(pageNumber, width, renderScale, {
						canvas: keep,
						cssHeight,
						aspect: base.height / base.width,
					})
				}

				/*
				 * The text layer: invisible positioned spans over the raster, which is what makes a
				 * PDF selectable at all. Laid out in *CSS* pixels (no dpr), and pdf.js sizes its spans
				 * from `--total-scale-factor`, so the container must carry it.
				 */
				textLayerEl.replaceChildren()
				textLayerEl.style.width = `${width}px`
				textLayerEl.style.height = `${cssHeight}px`
				textLayerEl.style.setProperty('--total-scale-factor', String(scale))
				textLayerEl.style.setProperty('--scale-factor', String(scale))
				const textLayer = new pdfjs.TextLayer({
					textContentSource: await page.getTextContent(),
					container: textLayerEl,
					viewport: page.getViewport({ scale }),
				})
				textTask = textLayer
				await textLayer.render()
				if (cancelled) return

				/*
				 * pdf.js's own viewer appends this sentinel after the spans and its selection code
				 * looks for it by class; the `TextLayer` class does not create one. Without it, a drag
				 * that runs past the last span selects erratically — which is most of what "selection
				 * is inconsistent" turns out to be. It must not be selectable itself.
				 */
				const endOfContent = document.createElement('div')
				endOfContent.className = 'endOfContent'
				textLayerEl.append(endOfContent)
			} catch (error) {
				// A cancelled render rejects; that is the mechanism working, not a failure.
				if (!cancelled) console.error(`Could not render PDF page ${pageNumber}`, error)
			}
		})()
		return () => {
			cancelled = true
			renderTask?.cancel()
			textTask?.cancel()
		}
	}, [doc, pageNumber, width])

	/**
	 * The marquee, in page fractions so it stays correct at any zoom. Listeners go on the window
	 * rather than the element: a crop that runs off the edge of the page is completely normal, and
	 * an element-scoped listener would drop the drag the moment it left.
	 */
	const startArea = (event: ReactPointerEvent<HTMLDivElement>) => {
		const bounds = event.currentTarget.getBoundingClientRect()
		const clamp = (n: number) => Math.min(1, Math.max(0, n))
		const origin = {
			x: clamp((event.clientX - bounds.left) / bounds.width),
			y: clamp((event.clientY - bounds.top) / bounds.height),
		}
		/*
		 * The rectangle lives in the gesture's own closure; the state is only what draws it.
		 *
		 * Reading it back out of a `setMarquee` updater instead — and taking the crop from in there —
		 * cost a real bug: React invokes updaters twice under StrictMode to prove they are pure, so a
		 * single crop called `onClipArea` twice and the board got **two quote cards and two relations,
		 * both holding the same image**. An updater must compute a value and nothing else.
		 */
		let area: AreaFraction = { ...origin, w: 0, h: 0 }
		setMarquee(area)

		const move = (moveEvent: PointerEvent) => {
			const x = clamp((moveEvent.clientX - bounds.left) / bounds.width)
			const y = clamp((moveEvent.clientY - bounds.top) / bounds.height)
			area = {
				x: Math.min(origin.x, x),
				y: Math.min(origin.y, y),
				w: Math.abs(x - origin.x),
				h: Math.abs(y - origin.y),
			}
			setMarquee(area)
		}
		const up = () => {
			window.removeEventListener('pointermove', move)
			window.removeEventListener('pointerup', up)
			setMarquee(null)
			// A click, not a drag: nothing to clip, and certainly not a 1px image.
			if (area.w > 0.01 && area.h > 0.01) onClipArea(pageNumber, area)
		}
		window.addEventListener('pointermove', move)
		window.addEventListener('pointerup', up)
	}

	return (
		<div
			className="lb-reader__page"
			data-page={pageNumber}
			style={{ width, height: height ?? undefined }}
		>
			<canvas ref={canvasRef} className="lb-reader__pdf-page" />
			{/*
			 * Under the text layer, so selecting a passage you have already quoted still works — a
			 * mark is a record of what you took, not a lid on it.
			 */}
			{highlights.map((highlight) =>
				highlight.rects.map((rect, index) => (
					<button
						key={`${highlight.quoteId}-${index}`}
						type="button"
						className="lb-reader__mark"
						title="Show this quote on the board"
						style={{
							left: `${rect.x * 100}%`,
							top: `${rect.y * 100}%`,
							width: `${rect.w * 100}%`,
							height: `${rect.h * 100}%`,
							...(highlight.hue === null
								? {}
								: { ['--lb-mark-h' as string]: String(highlight.hue) }),
						}}
						onClick={() => onHighlightClick(highlight.quoteId)}
					/>
				))
			)}
			<div ref={textLayerRef} className="lb-reader__text-layer textLayer" />
			{clipping && (
				<div className="lb-reader__marquee-host" onPointerDown={startArea}>
					{marquee && (
						<div
							className="lb-reader__marquee"
							style={{
								left: `${marquee.x * 100}%`,
								top: `${marquee.y * 100}%`,
								width: `${marquee.w * 100}%`,
								height: `${marquee.h * 100}%`,
							}}
						/>
					)}
				</div>
			)}
		</div>
	)
})
