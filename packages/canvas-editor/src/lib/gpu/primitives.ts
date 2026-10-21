/**
 * What a shape draws on the GPU layer (docs/gpu-renderer-plan.md): a short list of primitives, in
 * the shape's own space (its page transform is applied by the renderer), in the order they're drawn.
 * `ShapeUtil.toGpu` returns them, or `null` when the page draws that shape.
 *
 * The rule for adding a kind, or a `toGpu` to a shape: the GPU picture has to match the page's,
 * checked by `apps/web/e2e/parity.spec.ts` at every zoom, theme and pixel ratio.
 */

/** A colour, each channel 0–1, not premultiplied: red, green, blue, alpha. */
export type GpuColor = readonly [number, number, number, number]

/**
 * A rectangle, its corners rounded by `radius`, filled and/or outlined, painted as the browser paints
 * a CSS box: the outline inside the edge, over the fill; the fill runs under a see-through outline to
 * the outer edge, and stops at an opaque one's inner edge.
 */
export interface GpuRect {
	kind: 'rect'
	x: number
	y: number
	w: number
	h: number
	radius?: number
	fill?: GpuColor
	stroke?: GpuColor
	strokeWidth?: number
}

/**
 * A stroked SVG path (absolute M L H V Q C A Z) with round caps and joins, as the page strokes an
 * arrow or a line: `width` across, the dash pattern of `stroke-dasharray`/`stroke-dashoffset`.
 * `halo`: the arrow's halo instead, in the background colour and wider by `--tl-arrow-halo` each side.
 */
export interface GpuStroke {
	kind: 'stroke'
	d: string
	width: number
	color: GpuColor
	dash?: { array: readonly number[]; offset: number }
	halo?: boolean
}

/**
 * A picture the browser draws: text, an icon, anything a 2D canvas can draw the way the page does.
 * `draw` paints it into a context set up so that one unit is one of the shape's, with (0, 0) at (`x`,
 * `y`); the GPU layer keeps it in a texture at the scale and sub-pixel position it's seen at, and
 * draws it again when those change. Same `key`, same picture. `opacity` fades it as one, as the page
 * fades an element (a picture's own overlapping strokes don't show through each other).
 */
export interface GpuImage {
	kind: 'image'
	x: number
	y: number
	w: number
	h: number
	key: string
	draw: (ctx: CanvasRenderingContext2D) => void
	opacity?: number
}

export type GpuPrimitive = GpuRect | GpuStroke | GpuImage

/** What `toGpu` may need besides the shape. */
export interface GpuContext {
	isDarkMode: boolean
}

/** A CSS `stroke-dasharray`/`stroke-dashoffset` pair (as `getPerfectDashProps` gives them) as a `GpuStroke` dash, or none. */
export function gpuDash(array: string, offset: string): GpuStroke['dash'] {
	if (!array || array === 'none') return undefined
	const parts = array.split(/[\s,]+/).filter(Boolean).map(Number)
	if (!parts.length || parts.some((n) => !Number.isFinite(n) || n < 0) || parts.every((n) => n === 0)) return undefined
	return { array: parts, offset: Number(offset) || 0 }
}

/** A CSS colour (`#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`) as a `GpuColor`; transparent if it can't be read. */
export function gpuColor(css: string, alpha = 1): GpuColor {
	const c = readGpuColor(css)
	return c ? [c[0], c[1], c[2], c[3] * alpha] : [0, 0, 0, 0]
}

/** A CSS colour as a `GpuColor`, also as computed styles give them (`color(srgb r g b / a)`, `transparent`); null if it can't be read. */
export function readGpuColor(css: string): GpuColor | null {
	const s = css.trim()
	if (s === 'transparent') return [0, 0, 0, 0]
	if (s.startsWith('#')) {
		const hex = s.slice(1)
		const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex
		const n = (i: number) => parseInt(full.slice(i, i + 2), 16) / 255
		return [n(0), n(2), n(4), full.length >= 8 ? n(6) : 1]
	}
	const m = s.match(/^rgba?\(([^)]+)\)$/)
	if (m) {
		const p = m[1]!.split(/[\s,/]+/).filter(Boolean).map((v) => (v.endsWith('%') ? parseFloat(v) / 100 : Number(v)))
		if (p.length < 3 || p.some((v) => !Number.isFinite(v))) return null
		return [p[0]! / 255, p[1]! / 255, p[2]! / 255, p.length > 3 ? p[3]! : 1]
	}
	const srgb = s.match(/^color\(srgb ([^)]+)\)$/)
	if (srgb) {
		const p = srgb[1]!.split(/[\s/]+/).filter(Boolean).map((v) => (v.endsWith('%') ? parseFloat(v) / 100 : Number(v)))
		if (p.length < 3 || p.some((v) => !Number.isFinite(v))) return null
		return [p[0]!, p[1]!, p[2]!, p.length > 3 ? p[3]! : 1]
	}
	return null
}
