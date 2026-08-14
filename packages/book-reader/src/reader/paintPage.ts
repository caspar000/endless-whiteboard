/**
 * A picture of a reflowable page.
 *
 * A PDF hands its pixels over for nothing — it *is* a canvas. An EPUB page is live DOM inside an
 * iframe, and the platform offers no way to ask the compositor for what it has already drawn, so
 * to curl one you have to draw it again yourself.
 *
 * This does that the cheap way: it does not re-implement CSS, it *reads the layout the browser has
 * already done*. The unit is the **word**, not the line and not the paragraph — every word is
 * already positioned, `Range.getClientRects()` will say exactly where, and a word drawn at its own
 * measured position cannot drift. Line breaking, justification, indents, the lot come out right
 * because none of them are re-decided here; they are only read back.
 *
 * That is the second design. The first reconstructed *lines* by growing a range a character at a
 * time and watching for a new rectangle to appear, then drew each line as one string. It broke on
 * exactly the things line breaking is about: a hyphenated word straddling two lines lost its hyphen
 * and shed a stray letter onto the next line, and an off-by-one at a break cascaded into whole
 * lines going missing. Words have no such seam.
 *
 * The alternative was a DOM-to-canvas library, which re-renders the page from scratch: several
 * times the cost, a dependency of its own, and its own set of things it gets wrong.
 */

/** A page of prose is a few hundred words; beyond this something pathological is going on. */
const WORD_BUDGET = 4_000

export interface PaintedPage {
	texture: HTMLCanvasElement
	width: number
	height: number
}

/**
 * Paints what is visible in `doc` onto a canvas of the given size.
 *
 * Returns null when there is nothing worth painting, which the caller should treat as "no curl
 * this time" rather than as an error — a page turn that falls back to an instant cut is a great
 * deal better than one that stalls.
 */
export function paintPage(
	doc: Document,
	width: number,
	height: number,
	paper: string,
	/**
	 * Where the document's own origin sits relative to the page, in page pixels.
	 *
	 * Never zero for a paginated reflowable book, and that is the whole subtlety here. The renderer
	 * lays a chapter out as one long strip of columns and scrolls a container *around* the iframe,
	 * so the iframe is never scrolled itself: inside it, every rectangle is measured from the start
	 * of the chapter. Painting the window `[0, width]` of that space therefore paints the chapter's
	 * first page, wherever you actually are — which is exactly the bug this argument exists to fix.
	 */
	offset: { x: number; y: number }
): PaintedPage | null {
	const body = doc.body
	const view = doc.defaultView
	if (!body || !view || width < 2 || height < 2) return null

	const dpr = Math.min(2, view.devicePixelRatio || 1)
	const texture = document.createElement('canvas')
	texture.width = Math.ceil(width * dpr)
	texture.height = Math.ceil(height * dpr)
	const ctx = texture.getContext('2d')
	if (!ctx) return null
	ctx.scale(dpr, dpr)
	ctx.fillStyle = paper
	ctx.fillRect(0, 0, width, height)
	ctx.textBaseline = 'alphabetic'

	/** Whether any of a run's boxes fall on the page we are painting. */
	const onPage = (rect: DOMRect) =>
		rect.right + offset.x > 0 &&
		rect.left + offset.x < width &&
		rect.bottom + offset.y > 0 &&
		rect.top + offset.y < height

	const range = doc.createRange()
	let budget = WORD_BUDGET

	const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
	for (let node = walker.nextNode(); node && budget > 0; node = walker.nextNode()) {
		if (node.nodeType === Node.ELEMENT_NODE) {
			const element = node as Element
			if (element.tagName === 'IMG' || element.tagName === 'IMAGE') {
				drawImage(ctx, element, element.getBoundingClientRect(), offset, onPage)
			}
			continue
		}

		const text = node.nodeValue
		if (!text || !text.trim()) continue
		const parent = node.parentElement
		if (!parent) continue

		// Cheap rejection first: most of a chapter is off to the side, and measuring every word of
		// it would cost more than the whole page put together.
		range.selectNodeContents(node)
		const bounds = range.getBoundingClientRect()
		if (bounds.width <= 0 || !onPage(bounds)) continue

		const style = view.getComputedStyle(parent)
		if (style.visibility === 'hidden' || style.display === 'none') continue
		ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} / normal ${style.fontFamily}`
		ctx.fillStyle = style.color
		const metrics = ctx.measureText('Hxg')

		for (const word of words(text)) {
			if (budget-- <= 0) break
			range.setStart(node, word.start)
			range.setEnd(node, word.end)
			const boxes = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0)
			if (!boxes.length) continue

			const only = boxes[0]
			if (boxes.length === 1 && only) {
				if (onPage(only)) draw(ctx, word.text, only, offset, metrics)
				continue
			}
			// More than one box means the browser broke *inside* this word — a hyphenation, or a
			// word straddling the boundary between two columns. Each piece is drawn where its own
			// box says, which is the only way the two halves land on the right lines.
			for (const piece of splitWord(doc, node as Text, word, boxes)) {
				if (onPage(piece.rect)) draw(ctx, piece.text, piece.rect, offset, metrics)
			}
		}
	}

	return { texture, width, height }
}

/** Draws one run at the position the browser gave it, sitting on the same baseline. */
function draw(
	ctx: CanvasRenderingContext2D,
	text: string,
	rect: DOMRect,
	offset: { x: number; y: number },
	metrics: TextMetrics
): void {
	// A run's box is its line box: the glyphs sit inside it with half the leading above and below,
	// so the baseline is that gap plus the ascent — not some fraction of the height.
	const ascent = metrics.fontBoundingBoxAscent || rect.height * 0.8
	const descent = metrics.fontBoundingBoxDescent || rect.height * 0.2
	const leading = Math.max(0, (rect.height - (ascent + descent)) / 2)
	ctx.fillText(text, rect.left + offset.x, rect.top + offset.y + leading + ascent)
}

/** The words of a run, with where each one sits in the node. */
function words(text: string): { text: string; start: number; end: number }[] {
	const found: { text: string; start: number; end: number }[] = []
	const pattern = /\S+/g
	let match: RegExpExecArray | null
	while ((match = pattern.exec(text))) {
		found.push({ text: match[0], start: match.index, end: match.index + match[0].length })
	}
	return found
}

/**
 * Cuts a word into the pieces the browser put on each line.
 *
 * Walks the characters to find where each box begins — only ever for a word that is genuinely
 * broken, which is one or two per page. The hyphen is put back by hand because it is not in the
 * document at all: `hyphens: auto` draws one that no text node contains, so a word painted from
 * its own data would silently lose it.
 */
function splitWord(
	doc: Document,
	node: Text,
	word: { text: string; start: number; end: number },
	boxes: DOMRect[]
): { text: string; rect: DOMRect }[] {
	const pieces: { text: string; rect: DOMRect }[] = []
	const range = doc.createRange()
	let from = word.start

	for (let box = 0; box < boxes.length && from < word.end; box++) {
		const here = boxes[box]
		if (!here) break
		let to = word.end
		if (box < boxes.length - 1) {
			// The first character that has moved on to the next box ends this piece.
			for (let i = from + 1; i < word.end; i++) {
				range.setStart(node, i)
				range.setEnd(node, i + 1)
				const at = range.getBoundingClientRect()
				if (at.top > here.top + here.height / 2) {
					to = i
					break
				}
			}
		}
		const text = node.data.slice(from, to)
		if (text) {
			// A break inside a word draws a hyphen; one already spelled out does not need another.
			const hyphenated = box < boxes.length - 1 && !text.endsWith('-')
			pieces.push({ text: hyphenated ? `${text}-` : text, rect: here })
		}
		from = to
	}
	return pieces
}

function drawImage(
	ctx: CanvasRenderingContext2D,
	element: Element,
	rect: DOMRect,
	offset: { x: number; y: number },
	onPage: (rect: DOMRect) => boolean
): void {
	if (rect.width < 1 || rect.height < 1 || !onPage(rect)) return
	try {
		// Same-origin (the renderer serves the book from blob URLs), so the canvas stays clean.
		ctx.drawImage(
			element as CanvasImageSource,
			rect.left + offset.x,
			rect.top + offset.y,
			rect.width,
			rect.height
		)
	} catch {
		// An image that will not draw is not worth losing the whole page over.
	}
}
