import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
	memo,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { QUOTE_WIDTH, type NewQuote } from '../quote/createQuote'
import { loadPdfjs } from '../pdfjs'
import { PdfPage, type AreaFraction } from './PdfPage'
import { decodeRects, encodeRects, rectsFromRange, type QuoteRect } from '../quote/rects'
import { subscribeToReaderKeys, typingNow } from './keys'
import { createPageCache, prefetchAround } from './pageCache'
import { PageCurl } from './PageCurl'
import { ReaderFooter } from './ReaderFooter'
import { animatesPageTurns, SCROLL_BASE_WIDTH, withAlpha, type ReaderSettings } from './settings'
import type { Highlight, ReaderApi, ReaderSelection, TocItem, ViewMode } from './types'

/** Shared empty list: a new `[]` per render would defeat `PdfPage`'s memo on every page. */
const EMPTY_HIGHLIGHTS: readonly { quoteId: string; rects: QuoteRect[]; hue: number | null }[] = []

/** Padding around the page(s) inside the reader body. */
const GUTTER = 24
/** Space between the two pages of a spread. */
const SPREAD_GAP = 12
/**
 * How far outside the viewport a scrolled page renders, and how far out it is released again.
 *
 * Two different distances on purpose. Rendering eagerly (600px) means a page is ready before you
 * reach it; releasing lazily (2400px) means a small scroll back and forth never thrashes. Without
 * the release, scrolling through a long book accumulates every page it passes — for a few hundred
 * pages that is hundreds of canvases and text layers, and the scroll grinds to a halt.
 */
const RENDER_MARGIN = '600px'
const RELEASE_MARGIN = '2400px'

/**
 * The PDF reader: one page, a two-page spread, or a continuous scroll — all rendering the same
 * `PdfPage`, so selection, clipping and page tracking behave identically in each.
 *
 * Search is still out of scope (that is pdf.js-viewer territory); navigation is the outline, the
 * arrows, and the scroll bar.
 */
export function PdfReader({
	file,
	initialLocation,
	viewMode,
	settings,
	clipping,
	highlights,
	onRelocate,
	onSelect,
	onQuote,
	onReady,
	onClipDone,
	onHighlightClick,
}: {
	file: File
	/** The saved page number as a string, or ''. */
	initialLocation: string
	viewMode: ViewMode
	settings: ReaderSettings
	clipping: boolean
	/** Every quote taken from this book, to be drawn back onto its page. */
	highlights: readonly Highlight[]
	onRelocate(location: string, fraction: number): void
	onSelect(selection: ReaderSelection | null): void
	onQuote(quote: NewQuote): void
	onReady(api: ReaderApi): void
	/** Clip mode is one-shot: the reader turns it off once a crop is taken. */
	onClipDone(): void
	onHighlightClick(quoteId: string): void
}) {
	const bodyRef = useRef<HTMLDivElement | null>(null)
	/**
	 * Pages drawn before they are needed. Lives with the reader, so it is thrown away with the
	 * document rather than outliving it — and never mixes pages from two books.
	 */
	const cacheRef = useRef(createPageCache())
	const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
	const [failed, setFailed] = useState(false)
	const [toc, setToc] = useState<readonly TocItem[]>([])
	const [size, setSize] = useState({ w: 0, h: 0 })
	const [page, setPage] = useState(() => {
		const parsed = Number.parseInt(initialLocation, 10)
		return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1
	})
	/** Aspect ratios (height ÷ width) of pages we have rendered, for sizing scroll placeholders. */
	const [aspects, setAspects] = useState<Record<number, number>>({})

	const onRelocateRef = useRef(onRelocate)
	onRelocateRef.current = onRelocate
	const onSelectRef = useRef(onSelect)
	onSelectRef.current = onSelect

	useEffect(() => {
		let disposed = false
		// v6 lifecycle: the loading task, not the document proxy, owns `destroy`.
		let task: ReturnType<Awaited<ReturnType<typeof loadPdfjs>>['getDocument']> | null = null
		void (async () => {
			try {
				const pdfjs = await loadPdfjs()
				const loading = pdfjs.getDocument({ data: await file.arrayBuffer() })
				task = loading
				const next = await loading.promise
				if (!disposed) setDoc(next)
			} catch (error) {
				if (!disposed) {
					console.error('Could not open PDF', error)
					setFailed(true)
				}
			}
		})()
		return () => {
			disposed = true
			void task?.destroy()
		}
	}, [file])

	/**
	 * The first page's proportions, read before anything is drawn.
	 *
	 * Scroll placeholders are sized from this, so guessing it would mean every page that rendered
	 * *above* the viewport resized its slot and shoved the content below it — a scroll that lurches.
	 * One `getPage` is cheap; pages after the first are assumed to match until they say otherwise,
	 * which for real-world PDFs they do.
	 */
	useEffect(() => {
		if (!doc) return
		let cancelled = false
		void (async () => {
			try {
				const first = await doc.getPage(1)
				const { width, height } = first.getViewport({ scale: 1 })
				if (!cancelled) setAspects((current) => ({ ...current, 1: height / width }))
			} catch {
				// The A4 default below is a fine fallback; a failure here is not worth surfacing.
			}
		})()
		return () => {
			cancelled = true
		}
	}, [doc])

	/** The document outline, flattened. Resolving each destination to a page number is one call per
	 *  entry, so it happens once here rather than on every click. */
	useEffect(() => {
		if (!doc) return
		let cancelled = false
		void (async () => {
			try {
				const outline = await doc.getOutline()
				if (!outline || cancelled) return
				const items: TocItem[] = []
				const walk = async (nodes: typeof outline, depth: number) => {
					for (const node of nodes) {
						const target = await destinationPage(doc, node.dest)
						if (target) items.push({ label: node.title.trim(), target: String(target), depth })
						if (node.items?.length) await walk(node.items as typeof outline, depth + 1)
					}
				}
				await walk(outline, 0)
				if (!cancelled) setToc(items)
			} catch (error) {
				console.error('Could not read PDF outline', error)
			}
		})()
		return () => {
			cancelled = true
		}
	}, [doc])

	/**
	 * A page the reader has been *asked* to go to — by the outline, by resuming, or by switching into
	 * scrolling — as opposed to one it merely noticed you had scrolled past.
	 *
	 * The distinction is the whole reason scrolling is smooth. Both produce a new current page, but
	 * only a navigation may move the scroll position; if observing the scroll could also scroll, the
	 * two chase each other and the page snaps and skips under you.
	 */
	const pendingScrollRef = useRef<number | null>(null)
	// Lets effects read the current page without listing it as a dependency.
	const pageRef = useRef(page)
	pageRef.current = page

	const goTo = useCallback((target: string) => {
		const next = Number.parseInt(target, 10)
		if (!Number.isFinite(next) || next < 1) return
		backRef.current = next < pageRef.current
		if (curlsRef.current) captureRef.current = capturePages(leafRef.current)
		pendingScrollRef.current = next
		setPage(next)
	}, [])

	// Handed up whenever any of it changes, so the chrome always has a current outline and a
	// `clipPage` bound to the page actually on screen.
	useEffect(() => {
		onReady({ toc, goTo, clipPage: () => void renderClipRef.current() })
	}, [toc, goTo, onReady])

	// The body's size decides the render width, and both spread and fit-to-height depend on it.
	useLayoutEffect(() => {
		const body = bodyRef.current
		if (!body) return
		const observer = new ResizeObserver(() => {
			setSize({ w: body.clientWidth, h: body.clientHeight })
		})
		observer.observe(body)
		setSize({ w: body.clientWidth, h: body.clientHeight })
		return () => observer.disconnect()
	}, [])

	useEffect(() => {
		const cache = cacheRef.current
		return () => cache.clear()
	}, [doc])

	const pageCount = doc?.numPages ?? 0
	const firstAspect = aspects[1] ?? 1.414 // A4 portrait, until a real page says otherwise

	/**
	 * Render width per mode: paged modes fit the *whole page* on screen (height-bound, like paper),
	 * scrolling fills the width and lets you scroll (screen-bound, like a web page).
	 *
	 * Zoom multiplies whichever of those the mode chose, so 100% is always "the size the reader would
	 * have picked" and the setting stays meaningful as the window changes. Above that the page is
	 * allowed to outgrow the viewport — that is what zooming into a dense figure means, and the body
	 * scrolls to let you reach it.
	 */
	const zoom = settings.zoom / 100
	const pageWidth = useMemo(() => {
		if (!size.w || !size.h) return 0
		if (viewMode === 'scroll') return Math.max(80, Math.min(size.w - GUTTER * 2, SCROLL_BASE_WIDTH) * zoom)
		const available = viewMode === 'spread' ? (size.w - GUTTER * 2 - SPREAD_GAP) / 2 : size.w - GUTTER * 2
		const fromHeight = (size.h - GUTTER * 2) / firstAspect
		return Math.max(80, Math.min(available, fromHeight) * zoom)
	}, [size, viewMode, firstAspect, zoom])

	/**
	 * Draw the pages around this one while nothing is happening, so the next turn has nothing to
	 * wait for. Re-runs on every page change, which is what keeps the buffer ahead of you.
	 *
	 * Not in scrolling mode: that already renders a window of pages as real elements, and prefetching
	 * on top of it would be the same work twice.
	 */
	useEffect(() => {
		if (!doc || !pageCount || pageWidth <= 0 || viewMode === 'scroll') return
		if (settings.preloadPages <= 0) return
		return prefetchAround(cacheRef.current, doc, {
			page,
			pageCount,
			radius: settings.preloadPages,
			width: pageWidth,
			scale: settings.renderScale,
		})
	}, [doc, page, pageCount, pageWidth, viewMode, settings.preloadPages, settings.renderScale])

	/**
	 * Highlights indexed by page, decoded once rather than per render of each page: a book with
	 * three hundred quotes would otherwise re-parse all of them every time you turn a page.
	 */
	const highlightsByPage = useMemo(() => {
		const byPage = new Map<number, { quoteId: string; rects: QuoteRect[]; hue: number | null }[]>()
		for (const highlight of highlights) {
			const page = Number.parseInt(highlight.location, 10)
			const rects = decodeRects(highlight.rects)
			// A quote with no geometry (an older one, or a page clip) has nothing to draw.
			if (!Number.isFinite(page) || !rects.length) continue
			const list = byPage.get(page)
			const entry = { quoteId: highlight.quoteId, rects, hue: highlight.hue }
			if (list) list.push(entry)
			else byPage.set(page, [entry])
		}
		return byPage
	}, [highlights])

	const noteAspect = useCallback((pageNumber: number, aspect: number) => {
		setAspects((current) =>
			current[pageNumber] === aspect ? current : { ...current, [pageNumber]: aspect }
		)
	}, [])

	/** Which pages are on screen right now. In a spread, odd pages lead — the cover sits alone the
	 *  way a physical book's does. */
	const visiblePages = useMemo(() => {
		if (!pageCount) return []
		if (viewMode === 'spread') {
			// With the cover standing alone, odd pages lead and page one faces nothing — the way a
			// real book opens. Without it, pages pair from the very start.
			const left = settings.coverAlone
				? page % 2 === 0
					? page - 1
					: page
				: page % 2 === 0
					? page
					: page - 1
			return [left, left + 1].filter((n) => n >= 1 && n <= pageCount)
		}
		return [Math.min(Math.max(page, 1), pageCount)]
	}, [page, pageCount, viewMode, settings.coverAlone])

	/**
	 * The page you just left, kept on screen for the length of the turn so there is something to
	 * slide *out* while the new one slides in. Without it a "page turn" is a page appearing.
	 *
	 * Cheap, because the outgoing page is already rendered — this holds the same memoized `PdfPage`
	 * a moment longer rather than drawing anything new.
	 */
	const [outgoing, setOutgoing] = useState<{
		pages: number[]
		back: boolean
		capture: PageCapture | null
	} | null>(null)
	/** The leaf currently on screen — the thing a curl takes its picture of. */
	const leafRef = useRef<HTMLDivElement | null>(null)
	const captureRef = useRef<PageCapture | null>(null)
	const shownRef = useRef<{ pages: number[]; page: number }>({ pages: [], page })
	const animate = animatesPageTurns(settings) && viewMode !== 'scroll'
	const curls = animate && settings.pageTurn === 'curl'
	// Read by the turn handlers, which must not be rebuilt every time a setting changes.
	const curlsRef = useRef(curls)
	curlsRef.current = curls
	/**
	 * Which way the last page change went, recorded *as it is requested* rather than worked out
	 * afterwards.
	 *
	 * It has to be readable during the very render that mounts the new page, because that render is
	 * what starts the animation — an effect settles a frame too late, and the leaf begins turning
	 * forwards before being told it was going backwards. That restart is what made a back-turn
	 * stutter while a forward one was smooth.
	 */
	const backRef = useRef(false)

	/**
	 * The turn ends on `animationend`, but not every turn gets one — a tab backgrounded mid-slide
	 * never finishes its animation, and coming back to a page frozen half off the screen would be
	 * worse than no animation at all. This is the floor under that.
	 */
	useEffect(() => {
		if (!outgoing) return
		const timer = setTimeout(() => setOutgoing(null), 600)
		return () => clearTimeout(timer)
	}, [outgoing])

	/**
	 * The turn is set up *during* the render that changes the page, not in an effect afterwards.
	 *
	 * Both halves have to reach the screen in the same paint: the sheet arriving and the sheet it is
	 * replacing, along with the direction they are moving. Deriving it a commit later meant the new
	 * page painted once at rest before jumping back to start its slide — which is precisely the
	 * stutter that made going backwards feel worse than going forwards.
	 */
	if (shownRef.current.page === page) {
		// Kept current between turns as well, or the first turn of a session has no page to leave:
		// which pages are on screen is only settled once the document has loaded and said how many
		// there are, several renders after this ref was created.
		shownRef.current = { pages: visiblePages, page }
	} else {
		const from = shownRef.current
		shownRef.current = { pages: visiblePages, page }
		const capture = captureRef.current
		captureRef.current = null
		setOutgoing(
			animate && from.pages.length
				? { pages: from.pages, back: backRef.current, capture }
				: null
		)
	}

	const turn = useCallback(
		(delta: number) => {
			// A page turn invalidates whatever was selected on the page you just left.
			onSelectRef.current(null)
			backRef.current = delta < 0
			if (curlsRef.current) captureRef.current = capturePages(leafRef.current)
			const step = viewMode === 'spread' ? 2 * Math.sign(delta) : delta
			setPage((current) => Math.min(Math.max(current + step, 1), pageCount || 1))
		},
		[pageCount, viewMode]
	)

	// Report position on every change of page, in every mode.
	useEffect(() => {
		if (!pageCount) return
		onRelocateRef.current(String(page), page / pageCount)
	}, [page, pageCount])

	// Entering scrolling should land you where you were reading — that is a navigation, so it asks.
	useEffect(() => {
		if (viewMode === 'scroll') pendingScrollRef.current = pageRef.current
	}, [viewMode])

	/**
	 * Moves the scroll position, but *only* for a page change that was asked for. A page change the
	 * observer below merely noticed leaves the scroll alone, which is what makes scrolling free.
	 */
	useEffect(() => {
		if (viewMode !== 'scroll') return
		const wanted = pendingScrollRef.current
		if (wanted === null) return
		pendingScrollRef.current = null
		bodyRef.current?.querySelector(`[data-page="${wanted}"]`)?.scrollIntoView({ block: 'start' })
	}, [viewMode, page])

	/**
	 * Which page you are on while scrolling: the one showing the most of itself.
	 *
	 * Visibility is accumulated across callbacks because an observer reports only what *changed* —
	 * without keeping the rest, a single entry would decide the answer and the page number would
	 * flicker between neighbours as you scroll. "Most visible" also beats "topmost": a page with a
	 * sliver still on screen at the top is not the one you are reading.
	 */
	useEffect(() => {
		if (viewMode !== 'scroll' || !pageCount) return
		const body = bodyRef.current
		if (!body) return
		const visible = new Map<number, number>()
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					const number = Number(entry.target.getAttribute('data-page'))
					if (!number) continue
					if (entry.isIntersecting) visible.set(number, entry.intersectionRect.height)
					else visible.delete(number)
				}
				let best = 0
				let bestHeight = 0
				for (const [number, height] of visible) {
					if (height > bestHeight) {
						best = number
						bestHeight = height
					}
				}
				if (best) setPage((current) => (current === best ? current : best))
			},
			// Several thresholds so the ratios stay current as a page crosses the viewport, rather
			// than only firing as it enters and leaves.
			{ root: body, threshold: [0, 0.25, 0.5, 0.75, 1] }
		)
		for (const slot of body.querySelectorAll('[data-page]')) observer.observe(slot)
		return () => observer.disconnect()
	}, [viewMode, pageCount])

	useEffect(() => {
		return subscribeToReaderKeys((event) => {
			// Scrolling has its own keys; hijacking them would be worse than leaving them alone.
			if (viewMode === 'scroll') return
			// An arrow in a settings field is a caret, not a page turn.
			if (typingNow()) return
			if (event.key === 'ArrowLeft' || event.key === 'PageUp') turn(-1)
			else if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') turn(1)
			else return
			event.preventDefault()
		})
	}, [turn, viewMode])

	/**
	 * Selection is read on pointer *up* — mid-drag it is still being made, and a button that appears
	 * and jumps around under the cursor is unusable.
	 *
	 * Listened for on the *document*, not the page: a drag that starts on the last line and releases
	 * past the edge of the page is completely normal, and a page-scoped listener silently drops it.
	 * The page a quote belongs to comes from the DOM — the text layer it started in — which is what
	 * keeps this correct in a spread and while scrolling.
	 */
	useEffect(() => {
		if (clipping) return
		const onPointerUp = () => {
			const selected = window.getSelection()
			const text = selected?.toString().trim() ?? ''
			if (!selected || selected.rangeCount === 0 || !text) {
				onSelectRef.current(null)
				return
			}
			const anchor = selected.anchorNode
			const element = anchor?.nodeType === Node.ELEMENT_NODE ? (anchor as Element) : anchor?.parentElement
			const slot = element?.closest('[data-page]')
			if (!slot) return
			const pageNumber = Number(slot.getAttribute('data-page'))
			if (!pageNumber) return
			const range = selected.getRangeAt(0)
			const rect = range.getBoundingClientRect()
			onSelectRef.current({
				// Line breaks in a PDF are layout, not prose: joining them keeps a quote readable.
				text: text.replace(/\s+/g, ' '),
				location: String(pageNumber),
				locationLabel: `Page ${pageNumber}`,
				// Measured against the page, so the mark lands correctly at any zoom or view mode.
				rects: encodeRects(rectsFromRange(range, slot)),
				rect: { left: rect.left, top: rect.top, width: rect.width },
			})
		}
		document.addEventListener('pointerup', onPointerUp)
		return () => document.removeEventListener('pointerup', onPointerUp)
	}, [clipping])

	/** Renders part (or all) of a page to an image, at clip resolution. */
	const renderClip = useCallback(
		async (pageNumber: number, area: AreaFraction | null) => {
			if (!doc) return
			try {
				const pdfPage = await doc.getPage(pageNumber)
				const base = pdfPage.getViewport({ scale: 1 })
				// Scale so the *clipped* part comes out at the card's resolution, not the whole page:
				// a small crop should be sharp, not a postage stamp blown up.
				const scale = (QUOTE_WIDTH * settings.clipScale) / (base.width * (area?.w ?? 1))
				const viewport = pdfPage.getViewport({ scale })
				const full = document.createElement('canvas')
				full.width = Math.ceil(viewport.width)
				full.height = Math.ceil(viewport.height)
				const fullCtx = full.getContext('2d')
				if (!fullCtx) return
				// White behind the render: a PDF page is paper, and its own content is usually
				// transparent — without this a clip arrives with a black background.
				fullCtx.fillStyle = '#ffffff'
				fullCtx.fillRect(0, 0, full.width, full.height)
				await pdfPage.render({ canvas: full, canvasContext: fullCtx, viewport }).promise

				let out = full
				if (area) {
					const sx = Math.round(area.x * full.width)
					const sy = Math.round(area.y * full.height)
					const sw = Math.max(1, Math.round(area.w * full.width))
					const sh = Math.max(1, Math.round(area.h * full.height))
					out = document.createElement('canvas')
					out.width = sw
					out.height = sh
					const ctx = out.getContext('2d')
					if (!ctx) return
					ctx.drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh)
				}

				const blob = await new Promise<Blob | null>((resolve) =>
					out.toBlob(resolve, 'image/jpeg', 0.9)
				)
				if (blob) {
					onQuote({
						image: blob,
						location: String(pageNumber),
						locationLabel: `Page ${pageNumber}`,
					})
				}
			} catch (error) {
				console.error(`Could not clip PDF page ${pageNumber}`, error)
			}
		},
		[doc, onQuote, settings.clipScale]
	)

	const clipArea = useCallback(
		(pageNumber: number, area: AreaFraction) => {
			onClipDone()
			void renderClip(pageNumber, area)
		},
		[renderClip, onClipDone]
	)

	/**
	 * Kept in a ref so the `clipPage` handed to the chrome stays valid as you turn pages, without
	 * re-running the `onReady` effect (and so re-notifying the chrome) on every page change.
	 */
	const renderClipRef = useRef(() => Promise.resolve())
	renderClipRef.current = () => renderClip(page, null)

	if (failed) {
		return <p className="lb-reader__notice">This PDF could not be opened — it may be corrupt.</p>
	}

	return (
		<div
			className={viewMode === 'scroll' ? 'lb-reader__pdf lb-reader__pdf--scroll' : 'lb-reader__pdf'}
			ref={bodyRef}
			style={{
				['--lb-scroll-gap' as string]: `${settings.scrollGap}px`,
				['--lb-page-radius' as string]: `${settings.pageRadius}px`,
				['--lb-page-shadow' as string]: settings.pageShadow
					? `0 2px 18px ${withAlpha(settings.pageShadowColor, settings.pageShadowStrength)}`
					: 'none',
			}}
		>
			{doc && pageWidth > 0 && viewMode === 'scroll' ? (
				<div className="lb-reader__scroll">
					{Array.from({ length: pageCount }, (_, index) => index + 1).map((number) => (
						<ScrollSlot
							key={number}
							pageNumber={number}
							width={pageWidth}
							aspect={aspects[number] ?? firstAspect}
							root={bodyRef.current}
						>
							<PdfPage
								doc={doc}
								pageNumber={number}
								width={pageWidth}
								renderScale={settings.renderScale}
								cache={cacheRef.current}
								clipping={clipping}
								highlights={highlightsByPage.get(number) ?? EMPTY_HIGHLIGHTS}
								onClipArea={clipArea}
								onHighlightClick={onHighlightClick}
								onRendered={noteAspect}
							/>
						</ScrollSlot>
					))}
				</div>
			) : doc && pageWidth > 0 ? (
				<div className="lb-reader__spread">
					{/*
					 * The stage is exactly the size of the pages on it, and clips — which is what lets a
					 * sheet slide right off rather than drift across the desk. Only ever one sheet moves:
					 * going forward the old one slides away and the new is revealed beneath it; going
					 * back the new one slides in on top. The moving sheet is the one that casts a shadow,
					 * because it is the one that has been picked up.
					 */}
					<div
						className="lb-reader__stage"
						data-back={outgoing?.back ? '' : undefined}
						data-shadow={settings.pageShadow ? '' : undefined}
						data-turn={outgoing ? settings.pageTurn : undefined}
						// The slide's duration is a setting, so the keyframes read it from here.
						style={{ ['--lb-turn-ms' as string]: `${settings.turnMs}ms` }}
						// The turn is over when the sheet stops moving — no timer to keep in step with
						// the CSS, and nothing left on screen if the animation is cut short.
						onAnimationEnd={() => setOutgoing(null)}
					>
						{outgoing && !outgoing.capture && (
							<div className="lb-reader__leaf lb-reader__leaf--out" aria-hidden>
								{outgoing.pages.map((number) => (
									<PdfPage
										key={number}
										doc={doc}
										pageNumber={number}
										width={pageWidth}
										renderScale={settings.renderScale}
										clipping={false}
										highlights={highlightsByPage.get(number) ?? EMPTY_HIGHLIGHTS}
										onClipArea={clipArea}
										onHighlightClick={onHighlightClick}
										onRendered={noteAspect}
									/>
								))}
							</div>
						)}
						<div
							key={animate ? page : 'static'}
							className={animate ? 'lb-reader__leaf lb-reader__leaf--in' : 'lb-reader__leaf'}
							ref={leafRef}
						>
							{visiblePages.map((number) => (
								<PdfPage
									key={number}
									doc={doc}
									pageNumber={number}
									width={pageWidth}
									renderScale={settings.renderScale}
									cache={cacheRef.current}
									clipping={clipping}
									highlights={highlightsByPage.get(number) ?? EMPTY_HIGHLIGHTS}
									onClipArea={clipArea}
									onHighlightClick={onHighlightClick}
									onRendered={noteAspect}
								/>
							))}
						</div>

						{/*
						 * The curl draws the sheet itself, so the leaf it came from steps aside (see the
						 * stage's `data-turn`) and this canvas takes its place for the length of the turn.
						 * The texture is the page's own already-rendered canvas — nothing is drawn twice.
						 */}
						{outgoing?.capture && (
							<PageCurl
								texture={outgoing.capture.texture}
								textureWidth={outgoing.capture.texture.width}
								textureHeight={outgoing.capture.texture.height}
								width={outgoing.capture.width}
								height={outgoing.capture.height}
								back={outgoing.back}
								paper="#ffffff"
								settings={settings}
								onDone={() => setOutgoing(null)}
							/>
						)}

						{pageCount > 0 && (
							<ReaderFooter
								label={`${page} of ${pageCount}`}
								fraction={page / pageCount}
								onSeek={(fraction) => goTo(String(Math.max(1, Math.round(fraction * pageCount))))}
							/>
						)}
					</div>
				</div>
			) : null}

			{viewMode !== 'scroll' && (
				<>
					<button
						type="button"
						className="lb-reader__nav lb-reader__nav--left"
						onClick={() => turn(-1)}
						disabled={page <= 1}
						aria-label="Previous page"
					>
						<ChevronLeft aria-hidden />
					</button>
					<button
						type="button"
						className="lb-reader__nav lb-reader__nav--right"
						onClick={() => turn(1)}
						disabled={!doc || page >= pageCount}
						aria-label="Next page"
					>
						<ChevronRight aria-hidden />
					</button>
				</>
			)}
		</div>
	)
}

/**
 * A page's slot in scroll mode: reserves the right height up front, and only mounts the real page
 * when it comes near the viewport. Without this a 400-page book would rasterize 400 canvases on
 * open; with it, scrolling stays as cheap as the few pages you can actually see.
 *
 * Memoized because scrolling updates the current page, and a book has as many slots as it has
 * pages — re-rendering all of them on every scroll tick is exactly the kind of work that turns a
 * smooth scroll choppy.
 */
const ScrollSlot = memo(function ScrollSlot({
	pageNumber,
	width,
	aspect,
	root,
	children,
}: {
	pageNumber: number
	width: number
	aspect: number
	root: HTMLElement | null
	children: ReactNode
}) {
	const ref = useRef<HTMLDivElement | null>(null)
	const [near, setNear] = useState(false)
	/** Height the page turned out to be, kept after release so the slot doesn't resize when it goes. */
	const [rendered, setRendered] = useState<number | null>(null)

	useEffect(() => {
		const element = ref.current
		if (!element) return
		const render = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					setRendered(element.getBoundingClientRect().height || null)
					setNear(true)
				}
			},
			{ root, rootMargin: RENDER_MARGIN }
		)
		const release = new IntersectionObserver(
			(entries) => {
				if (entries.every((entry) => !entry.isIntersecting)) {
					// Remember the height *before* the page leaves: releasing must not change the
					// document's length, or everything below it shifts under the reader.
					setRendered(element.getBoundingClientRect().height || null)
					setNear(false)
				}
			},
			{ root, rootMargin: RELEASE_MARGIN }
		)
		render.observe(element)
		release.observe(element)
		return () => {
			render.disconnect()
			release.disconnect()
		}
	}, [root])

	return (
		<div
			ref={ref}
			className="lb-reader__slot"
			data-page={pageNumber}
			style={{ width, minHeight: near ? undefined : (rendered ?? width * aspect) }}
		>
			{near ? children : null}
		</div>
	)
})

/** The pixels of a page (or spread) as it stands on screen, and the size it was standing at. */
export interface PageCapture {
	texture: HTMLCanvasElement
	width: number
	height: number
}

/**
 * Copies whatever is on screen into a texture, for the curl to turn.
 *
 * A copy rather than a reference, because the page it came from is about to be replaced — and a
 * cheap one, since every pixel is already rasterized in a canvas the browser can blit. A spread is
 * composed back into a single image, gap and all, so the curl treats two pages as one sheet.
 */
function capturePages(leaf: HTMLElement | null): PageCapture | null {
	if (!leaf) return null
	const canvases = [...leaf.querySelectorAll('canvas')]
	const box = leaf.getBoundingClientRect()
	if (!canvases.length || box.width < 1 || box.height < 1) return null
	const dpr = Math.min(2, window.devicePixelRatio || 1)
	const texture = document.createElement('canvas')
	texture.width = Math.ceil(box.width * dpr)
	texture.height = Math.ceil(box.height * dpr)
	const ctx = texture.getContext('2d')
	if (!ctx) return null
	ctx.scale(dpr, dpr)
	for (const canvas of canvases) {
		const at = canvas.getBoundingClientRect()
		if (at.width < 1 || at.height < 1) continue
		ctx.drawImage(canvas, at.left - box.left, at.top - box.top, at.width, at.height)
	}
	return { texture, width: box.width, height: box.height }
}

/** Resolves an outline entry's destination to a 1-based page number, or null if it doesn't lead anywhere. */
async function destinationPage(
	doc: PDFDocumentProxy,
	dest: string | unknown[] | null
): Promise<number | null> {
	try {
		const resolved = typeof dest === 'string' ? await doc.getDestination(dest) : dest
		const ref = Array.isArray(resolved) ? resolved[0] : null
		if (!ref || typeof ref !== 'object') return null
		return (await doc.getPageIndex(ref as Parameters<typeof doc.getPageIndex>[0])) + 1
	} catch {
		// A malformed destination costs that one entry, never the outline.
		return null
	}
}
