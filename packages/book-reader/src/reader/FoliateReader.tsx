/// <reference path="../foliate-js.d.ts" />
import { ChevronLeft, ChevronRight, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FoliateLocation, View } from 'foliate-js/view.js'
import { FootnotePopover, type NoteAnchor } from './FootnotePopover'
import { PageCurl } from './PageCurl'
import { paintPage, type PaintedPage } from './paintPage'
import { ReaderFooter } from './ReaderFooter'
import { fontFaceCss, fontStack } from './fonts'
import { animatesPageTurns, withAlpha, type ReaderSettings } from './settings'
import type { Highlight, ReaderApi, ReaderSelection, TocItem, ViewMode } from './types'

/**
 * Injected into reflowable book content. `color-scheme: light` keeps book pages paper-coloured
 * even though the app chrome is dark — long-form text wants dark-on-light, and publishers' own
 * stylesheets assume it. Fixed-layout renderers (CBZ) have no `setStyles` and skip this.
 *
 * Text size is a percentage on `html` rather than a size on the body: an EPUB's own stylesheet
 * sizes everything in `em`s off the root, so scaling the root scales headings, notes and captions
 * in proportion instead of flattening the book's typography to one size.
 */
function bookCss(settings: ReaderSettings): string {
	const { textScale, lineHeight, font, justify, hyphenate, pageColor, textColor } = settings
	const stack = fontStack(font)
	// `color-scheme` follows the paper: a dark page needs the browser's own widgets and form
	// controls to be dark too, or a footnote's scrollbar arrives in the wrong century.
	const scheme = isDark(pageColor) ? 'dark' : 'light'
	return `
	${fontFaceCss()}
	html { color-scheme: ${scheme}; background: ${pageColor}; color: ${textColor}; font-size: ${textScale}%; }
	body, p, li, blockquote, dd, dt, td, th, figcaption,
	h1, h2, h3, h4, h5, h6 { color: ${textColor} !important; }
	p, li, blockquote, dd, td {
		line-height: ${lineHeight};
		text-align: ${justify ? 'justify' : 'start'};
		hyphens: ${hyphenate ? 'auto' : 'manual'};
		-webkit-hyphens: ${hyphenate ? 'auto' : 'manual'};
	}
	/* The book's own alignment beats ours: a centred epigraph is not body text. */
	[align='left'] { text-align: left; }
	[align='right'] { text-align: right; }
	[align='center'] { text-align: center; }
	${stack ? fontRule(stack) : ''}
`
}

/** Whether paper this colour wants light text on it — a rough luminance, which is all it needs. */
function isDark(colour: string): boolean {
	const hex = colour.replace('#', '')
	const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex
	const value = Number.parseInt(full, 16)
	if (!Number.isFinite(value) || full.length !== 6) return false
	const r = (value >> 16) & 255
	const g = (value >> 8) & 255
	const b = value & 255
	return (r * 299 + g * 587 + b * 114) / 1000 < 128
}

interface Position {
	/** What to call this place, in the most concrete terms the book supports. */
	label: string
	fraction: number
}

/**
 * Where you are, always phrased "n of N" — the same words a PDF's page count uses, because from the
 * reader's chair they answer the same question and the distinction is the format's problem, not
 * theirs.
 *
 * What is being counted does differ. foliate's *locations* are fixed spans of characters (Kindle's
 * device, and its word for it), which is the only count a reflowable book can offer that survives
 * a change of text size. A book carrying a page-list can name its printed page instead. Failing
 * both, a percentage is always true.
 */
function readPosition(detail: FoliateLocation | undefined): Position | null {
	if (!detail) return null
	const fraction = detail.fraction ?? 0
	const current = detail.location?.current
	const total = detail.location?.total
	if (typeof current === 'number' && typeof total === 'number' && total > 0) {
		// `current` counts from zero; readers count from one.
		return { label: `${(current + 1).toLocaleString()} of ${total.toLocaleString()}`, fraction }
	}
	const page = detail.pageItem?.label?.trim()
	if (page) return { label: page, fraction }
	return { label: `${Math.round(fraction * 100)}%`, fraction }
}

function noteAnchor(anchor: HTMLAnchorElement | undefined): NoteAnchor | null {
	if (!anchor) return null
	const inner = anchor.getBoundingClientRect()
	// The reference is inside the book's iframe; the frame's own position makes it a page coordinate.
	const frame = anchor.ownerDocument.defaultView?.frameElement?.getBoundingClientRect()
	return {
		left: inner.left + (frame?.left ?? 0) + inner.width / 2,
		top: inner.top + (frame?.top ?? 0),
		bottom: inner.bottom + (frame?.top ?? 0),
	}
}

/**
 * Setting a book in a chosen face means outranking the publisher's own stylesheet, which is why
 * this is `!important` and why it names elements rather than trusting inheritance from `body`: a
 * rule like `p { font-family: … }` in the book would otherwise win on every paragraph.
 *
 * `code` and `pre` are deliberately absent. The browser's own monospace rule for them beats an
 * inherited value whatever its importance, so a listing in a technical book stays a listing.
 */
function fontRule(stack: string): string {
	return `body, p, li, blockquote, dd, dt, td, th, figcaption,
	h1, h2, h3, h4, h5, h6 { font-family: ${stack} !important; }`
}

/**
 * Everything that isn't a PDF: EPUB, MOBI/AZW3, FB2 and CBZ, all through foliate's `<foliate-view>`
 * element. The element owns pagination, per-format parsing and position CFIs; this wrapper owns
 * mounting it into React, relaying relocations and selections, and translating the shared view
 * modes into the renderer's own attributes.
 */
export function FoliateReader({
	file,
	initialLocation,
	viewMode,
	settings,
	highlights,
	onRelocate,
	onSelect,
	onReady,
	onHighlightClick,
}: {
	file: File
	/** The saved CFI from a previous session, or ''. */
	initialLocation: string
	viewMode: ViewMode
	settings: ReaderSettings
	/** Every quote taken from this book. Only their CFIs matter here — foliate redraws the rest. */
	highlights: readonly Highlight[]
	onRelocate(location: string, fraction: number): void
	onSelect(selection: ReaderSelection | null): void
	onReady(api: ReaderApi): void
	onHighlightClick(quoteId: string): void
}) {
	const hostRef = useRef<HTMLDivElement | null>(null)
	const viewRef = useRef<View | null>(null)
	const [failed, setFailed] = useState(false)
	const [toc, setToc] = useState<readonly TocItem[]>([])
	/**
	 * Whether the book reflows, decided by the renderer the format chose rather than by the
	 * extension: `setStyles` is exactly the capability that separates the paginator from the
	 * fixed-layout renderer. A comic (CBZ) has pages of its own size and its own typography, so it
	 * takes neither the injected CSS nor the paper page below.
	 */
	const [reflowable, setReflowable] = useState(true)
	/** Where you are, as the book itself can describe it. Null until the first relocation. */
	const [position, setPosition] = useState<Position | null>(null)
	/** Whether a link has been followed, so the way back can be offered. */
	const [canGoBack, setCanGoBack] = useState(false)
	/** The reference an open footnote hangs from, or null when none is open. */
	const [note, setNote] = useState<NoteAnchor | null>(null)
	/** Whether a page turn is in flight — see the gutter, which cannot be drawn across one. */
	const [turning, setTurning] = useState(false)
	/** The page being left, painted, while it curls away. */
	const [curl, setCurl] = useState<(PaintedPage & { back: boolean }) | null>(null)

	// Refs, not deps: none of these may re-run the mount effect — reopening the book loses the
	// reader's place and re-parses the file for nothing.
	const onRelocateRef = useRef(onRelocate)
	onRelocateRef.current = onRelocate
	const onSelectRef = useRef(onSelect)
	onSelectRef.current = onSelect
	const onHighlightClickRef = useRef(onHighlightClick)
	onHighlightClickRef.current = onHighlightClick
	const initialLocationRef = useRef(initialLocation)
	// Read at mount only, for the same reason: a book must open with the current text size, but
	// changing it later goes through the effect below rather than re-opening the book.
	const settingsRef = useRef(settings)
	settingsRef.current = settings
	/**
	 * Highlights by CFI, so the draw and click handlers — installed once, at mount — can always see
	 * the current set. They are registered on the view itself and cannot be re-bound per render.
	 */
	const highlightsRef = useRef(highlights)
	highlightsRef.current = highlights
	/**
	 * Where the reference sat, held between the click and foliate finishing the render.
	 *
	 * A ref because those are two separate events on two separate objects, and by the time the note
	 * has been extracted the click is long gone — but the popover has to appear beside the word that
	 * raised it, not in the middle of the screen.
	 */
	const pendingNoteRef = useRef<NoteAnchor | null>(null)
	/** Where the note is mounted, and the view mounted into it — both owned imperatively. */
	const frameRef = useRef<HTMLDivElement | null>(null)
	const noteHostRef = useRef<HTMLDivElement | null>(null)
	const noteViewRef = useRef<View | null>(null)

	const closeNote = useCallback(() => {
		noteViewRef.current?.close()
		noteViewRef.current?.remove()
		noteViewRef.current = null
		setNote(null)
	}, [])
	const closeNoteRef = useRef(closeNote)
	closeNoteRef.current = closeNote

	/**
	 * Turning a page, and saying so.
	 *
	 * Every turn this reader initiates comes through here. A swipe on a touch screen is handled by
	 * the renderer itself and does not, so the seam stays put through one of those — the timeout
	 * below is also what covers a turn that never relocates, at the very start or end of a book.
	 */
	const turn = useCallback((direction: -1 | 1) => {
		const view = viewRef.current
		if (!view) return
		setTurning(true)
		/*
		 * A curl needs the page as pixels, and a reflowable page has none to hand — so it is painted
		 * here, from the layout the browser has already done (see `paintPage`), before the renderer
		 * is allowed to move. The renderer then jumps straight to the next page underneath, and the
		 * picture curls off the top of it.
		 */
		const settings = settingsRef.current
		if (settings.pageTurn === 'curl' && animatesPageTurns(settings)) {
			const doc = view.renderer.getContents?.()[0]?.doc
			const box = frameRef.current?.getBoundingClientRect()
			// Where the chapter's own origin sits relative to the page. The renderer scrolls a
			// container *around* the iframe rather than the iframe itself, so the iframe's position
			// is how far into the chapter we are — and without it every turn paints page one.
			const inner = doc?.defaultView?.frameElement?.getBoundingClientRect()
			if (doc && box && inner) {
				const painted = paintPage(doc, box.width, box.height, settings.pageColor, {
					x: inner.left - box.left,
					y: inner.top - box.top,
				})
				if (painted) setCurl({ ...painted, back: direction < 0 })
			}
		}
		void (direction < 0 ? view.goLeft() : view.goRight())
	}, [])

	useEffect(() => {
		if (!turning) return
		const timer = setTimeout(() => setTurning(false), 900)
		return () => clearTimeout(timer)
	}, [turning])

	useEffect(() => {
		const host = hostRef.current
		if (!host) return
		let disposed = false
		let view: View | null = null
		void (async () => {
			try {
				// Importing the module registers the custom element; formats load lazily inside it.
				await import('foliate-js/view.js')
				const { FootnoteHandler } = await import('foliate-js/footnotes.js')
				if (disposed) return

				/*
				 * foliate knows a footnote when it sees one — `epub:type="noteref"`, `role="doc-noteref"`,
				 * or the superscript heuristic for the many books that declare neither — and renders just
				 * that note into a view of its own rather than navigating to it.
				 */
				const footnotes = new FootnoteHandler()
				footnotes.detectFootnotes = settingsRef.current.detectFootnotes
				/*
				 * `before-render`, not `render`: foliate hands the note's view over *before* asking it
				 * to lay the fragment out, and an element that is not in the document has no size to
				 * lay anything out into. So it is attached here, synchronously — going through React
				 * state would attach it a task too late, and the note would come back blank.
				 */
				footnotes.addEventListener('before-render', (event) => {
					const noteView = (event as CustomEvent<{ view: View }>).detail.view
					const anchor = pendingNoteRef.current
					pendingNoteRef.current = null
					const host = noteHostRef.current
					if (!anchor || !host || disposed) {
						noteView.close()
						return
					}
					closeNoteRef.current()
					noteView.renderer?.setStyles?.(bookCss(settingsRef.current))
					noteViewRef.current = noteView
					host.append(noteView)
					setNote(anchor)
				})

				view = document.createElement('foliate-view') as View
				view.className = 'lb-reader__foliate'
				view.addEventListener('relocate', (event) => {
					const detail = (event as CustomEvent<FoliateLocation & { cfi?: string }>).detail
					if (detail?.cfi) onRelocateRef.current(detail.cfi, detail.fraction ?? 0)
					setPosition(readPosition(detail))
					// The renderer relocates once the scroll has settled, which is the end of the turn.
					setTurning(false)
					// A page turn invalidates whatever was selected on the page you just left.
					onSelectRef.current(null)
				})
				/*
				 * A footnote is answered in place; anything else is a genuine navigation, and the
				 * history it pushes is what the back button walks. Between them these cover both ways
				 * a reference can strand you — see `FootnotePopover`.
				 */
				view.addEventListener('link', (event) => {
					const detail = (event as CustomEvent<{ a?: HTMLAnchorElement }>).detail
					const anchorRect = noteAnchor(detail?.a)
					const handled = footnotes.handle(view!.book, event)
					if (!handled) return
					pendingNoteRef.current = anchorRect
					handled.catch((error) => {
						console.error('Could not open footnote', error)
						pendingNoteRef.current = null
						// The note could not be extracted, so fall back to going there properly —
						// which at least leaves a history entry to come back from.
						if (detail && 'href' in detail) void view?.goTo(String(detail.href))
					})
				})
				view.history.addEventListener('index-change', () => {
					setCanGoBack(view?.history.canGoBack ?? false)
				})
				/*
				 * Marks in the book. foliate owns the drawing: it resolves each CFI back to a range in
				 * whatever layout the section currently has — which is the only way this can work for a
				 * reflowable book, where the passage moves whenever the window does.
				 *
				 * The colour is the tag's own hue, the same number the chip on the card uses.
				 */
				view.addEventListener('draw-annotation', (event) => {
					const detail = (event as CustomEvent<{
						draw(func: unknown, options?: unknown): void
						annotation: { value?: string }
					}>).detail
					const found = highlightsRef.current.find((h) => h.location === detail.annotation.value)
					void (async () => {
						const { Overlayer } = await import('foliate-js/overlayer.js')
						detail.draw(Overlayer.highlight, {
							color: markColour(found?.hue ?? null, settingsRef.current.markOpacity),
						})
					})()
				})
				view.addEventListener('show-annotation', (event) => {
					const value = (event as CustomEvent<{ value?: string }>).detail?.value
					const found = highlightsRef.current.find((h) => h.location === value)
					if (found) onHighlightClickRef.current(found.quoteId)
				})
				/*
				 * A section's overlay is created when that section renders, and it starts empty —
				 * marks live on the overlay, not in the book. So every time one appears, the quotes
				 * are handed to it again. Without this a highlight shows up when you make it and is
				 * gone the next time you open the book, which is the opposite of the point.
				 */
				view.addEventListener('create-overlay', () => {
					for (const highlight of highlightsRef.current) {
						if (highlight.location) void view?.addAnnotation({ value: highlight.location })
					}
				})
				/*
				 * Book content lives in an iframe per section, so selection has to be watched from
				 * inside each document as it loads — `window.getSelection()` out here never sees it.
				 * The `load` event hands us that document and its section index, and the index is
				 * exactly what `getCFI` needs to turn a selected range into a durable location.
				 */
				view.addEventListener('load', (event) => {
					const detail = (event as CustomEvent<{ doc?: Document; index?: number }>).detail
					const doc = detail?.doc
					if (!doc || typeof detail?.index !== 'number') return
					const index = detail.index
					doc.addEventListener('pointerup', () => {
						const selected = doc.getSelection()
						const text = selected?.toString().trim() ?? ''
						if (!selected || selected.rangeCount === 0 || !text) {
							onSelectRef.current(null)
							return
						}
						const range = selected.getRangeAt(0)
						const inner = range.getBoundingClientRect()
						// Range coordinates are relative to the iframe's own viewport; the frame's
						// position converts them to this page's, which is what the button needs.
						const frame = doc.defaultView?.frameElement?.getBoundingClientRect()
						// The chapter you are in, as the book names it. Read from the last relocation
						// rather than resolved per section: the selection is on the current page by
						// definition, so that *is* its chapter, and foliate's TOC lookup is private.
						const label = viewRef.current?.lastLocation?.tocItem?.label?.trim() ?? ''
						onSelectRef.current({
							text: text.replace(/\s+/g, ' '),
							location: viewRef.current?.getCFI(index, range) ?? '',
							locationLabel: label,
							// No geometry: a reflowable book's layout changes with the window, so the CFI
							// is the only durable description of the passage — and foliate redraws from it.
							rects: '',
							rect: {
								left: inner.left + (frame?.left ?? 0),
								top: inner.top + (frame?.top ?? 0),
								width: inner.width,
							},
						})
					})
				})
				host.append(view)
				await view.open(file)
				if (disposed) return
				setReflowable(typeof view.renderer.setStyles === 'function')
				view.renderer.setStyles?.(bookCss(settingsRef.current))
				viewRef.current = view
				setToc(flattenToc(view.book.toc ?? []))
				await view.init({ lastLocation: initialLocationRef.current || undefined })
			} catch (error) {
				console.error('Could not open book', error)
				if (!disposed) setFailed(true)
			}
		})()
		return () => {
			disposed = true
			viewRef.current = null
			view?.close()
			view?.remove()
		}
	}, [file])

	/**
	 * The shared view modes, in the renderer's own terms. A reflowable book has no "pages" to place
	 * side by side — a spread is two *columns* of the same flow — so the mapping is: one column, two
	 * columns, or no columns at all and a continuous scroll.
	 */
	useEffect(() => {
		const renderer = viewRef.current?.renderer
		if (!renderer) return
		renderer.setAttribute('flow', viewMode === 'scroll' ? 'scrolled' : 'paginated')
		renderer.setAttribute('max-column-count', viewMode === 'spread' ? '2' : '1')
		// The page element is already this wide (see the paper below), so this tells the renderer to
		// fill it with one column rather than apply a narrower cap of its own — and, in a spread,
		// where to split the two.
		// The text column is the page less its side margins, which is how "margin X" is expressed
		// to a renderer that only knows how wide to let the text run.
		const column = Math.max(120, settings.pageWidth - settings.marginX * 2)
		renderer.setAttribute('max-inline-size', `${column}px`)
		renderer.setAttribute('margin', `${settings.marginY}px`)
		renderer.setAttribute('gap', `${settings.columnGap}%`)
		/*
		 * The slide, which the renderer already knows how to do: with `animated` set it eases the
		 * column scroll over 300ms instead of jumping, and skips the settling delay it otherwise
		 * needs. Turning pages is the one animation a reader has, so it is the one worth having.
		 */
		if (animatesPageTurns(settings) && settings.pageTurn !== 'curl') {
			renderer.setAttribute('animated', '')
		} else {
			// A curl draws the turn itself, over a renderer that has already jumped.
			renderer.removeAttribute('animated')
		}
	}, [viewMode, toc, settings])

	/**
	 * Typography, re-applied live. `setStyles` restyles the section on screen without re-laying the
	 * book out from the start, so dragging the text-size slider reads as the page reflowing under
	 * your eyes — and the CFI the reader is anchored to keeps your place across the change.
	 */
	useEffect(() => {
		viewRef.current?.renderer.setStyles?.(bookCss(settings))
	}, [settings, toc])

	/**
	 * Registers each quote with the view, which then draws it whenever its section is on screen.
	 *
	 * Re-run whenever the set changes, and idempotent by CFI on foliate's side (`addAnnotation`
	 * removes before adding), so a new quote appears the moment it is taken — including on the page
	 * you are looking at, which is what makes highlighting feel like marking a book.
	 */
	useEffect(() => {
		const view = viewRef.current
		if (!view) return
		for (const highlight of highlights) {
			if (highlight.location) void view.addAnnotation({ value: highlight.location })
		}
	}, [highlights, toc])

	useEffect(() => {
		onReady({
			toc,
			goTo: (target) => void viewRef.current?.goTo(target),
			// No `clipPage`: a reflowable book has no page to clip — its "pages" are a function of
			// the window size, so an image of one would mean nothing when reopened.
		})
	}, [toc, onReady])

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (viewMode === 'scroll') return
			if (event.key === 'ArrowLeft' || event.key === 'PageUp') turn(-1)
			else if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') turn(1)
			else return
			event.preventDefault()
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [viewMode, turn])

	if (failed) {
		return <p className="lb-reader__notice">This book could not be opened — it may be corrupt.</p>
	}

	return (
		/*
		 * The page itself is drawn in CSS from these two numbers — the width you chose and the height
		 * paper implies. Kept as custom properties rather than sizing the element here because the
		 * view element is created imperatively below, and because the spread and scrolling variants
		 * are the same page rule with one dimension released.
		 */
		<div
			className="lb-reader__book"
			data-mode={viewMode}
			data-layout={reflowable ? 'reflowable' : 'fixed'}
			style={{
				['--lb-page-w' as string]: `${settings.pageWidth}px`,
				['--lb-page-h' as string]: `${settings.pageHeight}px`,
				['--lb-page-colour' as string]: settings.pageColor,
				['--lb-page-radius' as string]: `${settings.pageRadius}px`,
				['--lb-page-shadow' as string]: settings.pageShadow
					? `0 2px 18px ${withAlpha(settings.pageShadowColor, settings.pageShadowStrength)}`
					: 'none',
				['--lb-seam' as string]: withAlpha(settings.pageSeamColor, settings.pageSeamStrength),
				['--lb-seam-soft' as string]: withAlpha(
					settings.pageSeamColor,
					settings.pageSeamStrength * 0.66
				),
			}}
		>
			{/*
			 * The page itself, and the frame everything about the page hangs off: the paper, its
			 * proportions, and the position line printed at the foot of it. The view fills it.
			 */}
			<div
				className="lb-reader__frame"
				ref={(element) => {
					hostRef.current = element
					frameRef.current = element
				}}
			>
				{viewMode === 'spread' && reflowable && settings.pageSeam && (
					// The seam between two pages of a spread, so it reads as two sheets rather than one
					// very wide one.
					<div className="lb-reader__gutter" data-turning={turning ? '' : undefined} aria-hidden />
				)}
				{curl && (
					<PageCurl
						texture={curl.texture}
						textureWidth={curl.texture.width}
						textureHeight={curl.texture.height}
						width={curl.width}
						height={curl.height}
						back={curl.back}
						paper={settings.pageColor}
						settings={settings}
						onDone={() => setCurl(null)}
					/>
				)}

				{position && (
					<ReaderFooter
						label={position.label}
						fraction={position.fraction}
						onSeek={(fraction) => void viewRef.current?.goToFraction(fraction)}
					/>
				)}
			</div>

			{viewMode !== 'scroll' && (
				<>
					<button
						type="button"
						className="lb-reader__nav lb-reader__nav--left"
						onClick={() => turn(-1)}
						aria-label="Previous page"
					>
						<ChevronLeft aria-hidden />
					</button>
					<button
						type="button"
						className="lb-reader__nav lb-reader__nav--right"
						onClick={() => turn(1)}
						aria-label="Next page"
					>
						<ChevronRight aria-hidden />
					</button>
				</>
			)}

			{/*
			 * The way back from a cross-reference that *did* move you — a chapter link, an index entry,
			 * a note too long to show in place. It appears only once there is somewhere to go back to,
			 * because a permanently disabled button is furniture.
			 */}
			{canGoBack && (
				<button
					type="button"
					className="lb-reader__back"
					onClick={() => viewRef.current?.history.back()}
					title="Back to where you were"
				>
					<Undo2 size={13} aria-hidden />
					Back
				</button>
			)}

			<FootnotePopover anchor={note} hostRef={noteHostRef} onClose={closeNote} />
		</div>
	)
}

/**
 * A mark's colour: the tag's hue if it has one, otherwise the app's accent.
 *
 * Translucent so the words stay readable through it — a highlighter, not a redaction. The same
 * lightness and alpha as the PDF marks, so a quote looks the same in either kind of book.
 */
export function markColour(hue: number | null, opacity: number): string {
	return hue === null
		? `rgb(108 140 255 / ${opacity * 0.86}%)`
		: `hsl(${hue} 85% 55% / ${opacity}%)`
}

/** foliate's TOC is a tree of `{label, href, subitems}`; the panel wants a flat, depth-tagged list. */
function flattenToc(
	nodes: readonly { label?: string; href?: string; subitems?: unknown }[],
	depth = 0
): TocItem[] {
	const items: TocItem[] = []
	for (const node of nodes) {
		const label = node.label?.trim()
		if (label && node.href) items.push({ label, target: node.href, depth })
		if (Array.isArray(node.subitems)) {
			items.push(...flattenToc(node.subitems as typeof nodes, depth + 1))
		}
	}
	return items
}
