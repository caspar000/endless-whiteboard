/** A rectangle in page fractions — resolution-independent, so it lands correctly at any zoom. */
export interface QuoteRect {
	x: number
	y: number
	w: number
	h: number
}

/** Three decimals is ~half a pixel on a 1000px-wide page, and keeps the encoded string short. */
const PRECISION = 3

/**
 * Rectangles as one scalar string, `x,y,w,h;x,y,w,h`.
 *
 * Props are bounded to JSON scalars (§7) — an array of objects would break the one-level equality
 * that keeps dragging free of recomputes — so this follows the `link` property's precedent and
 * encodes structure into a string it fully controls.
 */
export function encodeRects(rects: readonly QuoteRect[]): string {
	return rects
		.filter((rect) => rect.w > 0 && rect.h > 0)
		.map((rect) =>
			[rect.x, rect.y, rect.w, rect.h].map((n) => round(n)).join(',')
		)
		.join(';')
}

/** Anything malformed is dropped rather than trusted: a bad rect must cost a mark, never a render. */
export function decodeRects(value: string): QuoteRect[] {
	if (!value) return []
	const rects: QuoteRect[] = []
	for (const part of value.split(';')) {
		const numbers = part.split(',').map(Number)
		if (numbers.length !== 4 || numbers.some((n) => !Number.isFinite(n))) continue
		const [x, y, w, h] = numbers as [number, number, number, number]
		if (w <= 0 || h <= 0) continue
		rects.push({ x, y, w, h })
	}
	return rects
}

function round(n: number): number {
	const factor = 10 ** PRECISION
	return Math.round(n * factor) / factor
}

/**
 * The rectangles a DOM selection covers, relative to a page element.
 *
 * `getClientRects` rather than the bounding box: a passage spanning three lines is three rectangles,
 * and one box around them would paint over the margin and everything between.
 */
export function rectsFromRange(range: Range, page: Element): QuoteRect[] {
	const bounds = page.getBoundingClientRect()
	if (!bounds.width || !bounds.height) return []
	const out: QuoteRect[] = []
	for (const rect of Array.from(range.getClientRects())) {
		// Zero-height rects appear at line boundaries and would render as invisible slivers.
		if (rect.width <= 0 || rect.height <= 0) continue
		out.push({
			x: (rect.left - bounds.left) / bounds.width,
			y: (rect.top - bounds.top) / bounds.height,
			w: rect.width / bounds.width,
			h: rect.height / bounds.height,
		})
	}
	return out
}
