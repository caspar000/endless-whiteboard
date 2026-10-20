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

export type GpuPrimitive = GpuRect

/** What `toGpu` may need besides the shape. */
export interface GpuContext {
	isDarkMode: boolean
}

/** A CSS colour (`#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`) as a `GpuColor`; transparent if it can't be read. */
export function gpuColor(css: string, alpha = 1): GpuColor {
	const s = css.trim()
	if (s.startsWith('#')) {
		const hex = s.slice(1)
		const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex
		const n = (i: number) => parseInt(full.slice(i, i + 2), 16) / 255
		return [n(0), n(2), n(4), (full.length >= 8 ? n(6) : 1) * alpha]
	}
	const m = s.match(/rgba?\(([^)]+)\)/)
	if (m) {
		const p = m[1]!.split(/[\s,/]+/).filter(Boolean).map(Number)
		return [p[0]! / 255, p[1]! / 255, p[2]! / 255, (p.length > 3 ? p[3]! : 1) * alpha]
	}
	return [0, 0, 0, 0]
}
