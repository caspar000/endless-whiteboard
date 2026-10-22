import { rasterCanvas } from './atlas'
import type { GpuColor } from './primitives'

/**
 * What each picture the element reader makes (`snapshots.ts`) draws, as plain data, and the one
 * function that draws it: so a picture read from the page and one kept from an earlier session
 * (`snapshotCache.ts`) are drawn by the same code. Everything here survives `structuredClone`.
 */

export type Corner = { x: number; y: number }
export type Radius = number | { x: number; y: number }
export type Gradient = { angle: number; stops: { at: number; color: string }[] }
export type Sides = { widths: number[]; colors: string[] }
type Box = { x: number; y: number; w: number; h: number }
type Cut = Box & { corners: Corner[] }

/**
 * What a canvas draws text with besides `font`: it takes these from its own element's style, so they
 * are copied onto it from the text's element (tabular figures, ligatures, font smoothing...).
 */
export const FONT_PROPS = [
	'font-variant-numeric',
	'font-variant-ligatures',
	'font-variant-caps',
	'font-variant-east-asian',
	'font-variant-alternates',
	'font-feature-settings',
	'font-variation-settings',
	'font-kerning',
	'font-optical-sizing',
	'-webkit-font-smoothing',
	'text-rendering',
] as const

export interface TextStyle {
	font: string
	/** The `FONT_PROPS` values, in order. */
	props: string[]
	letterSpacing: string
	wordSpacing: string
}

/** The shared raster canvas set up to draw or measure text in `t`. */
export function textContext(t: TextStyle): CanvasRenderingContext2D {
	const { canvas, ctx } = rasterCanvas()
	FONT_PROPS.forEach((prop, i) => canvas.style.setProperty(prop, t.props[i]!))
	ctx.font = t.font
	ctx.letterSpacing = t.letterSpacing
	ctx.wordSpacing = t.wordSpacing
	return ctx
}

export type Recipe =
	/** A rect cut to rounded corners (`cutToCorners`). */
	| { t: 'rect'; w: number; h: number; radius: number; fill: GpuColor | null; stroke: GpuColor | null; strokeWidth: number; cut: Cut; at: { x: number; y: number } }
	/** Another picture cut to rounded corners. */
	| { t: 'cut'; cut: Cut; at: { x: number; y: number }; inner: Recipe }
	| { t: 'box'; w: number; h: number; radius: number; fill: GpuColor; gradient: Gradient | null; gradientLine: [number, number, number, number] | null; path: string | null; sides: Sides | null }
	| { t: 'dashed'; w: number; h: number; radius: number; bw: number; css: string; inset: number; cw: number; ch: number; cr: number; dash: number; gap: number; pad: number }
	| { t: 'shadow'; w: number; h: number; bx: number; by: number; bw: number; bh: number; radius: Radius; shade: string; blur: number; dx: number; dy: number; spread: number; far: number }
	| { t: 'text'; style: TextStyle; ink: string; shadows: { color: string; x: number; y: number }[]; runs: { text: string; x: number }[]; baseline: number }
	| { t: 'img'; url: string; w: number; h: number; cut: Cut | null; at: { x: number; y: number }; b: Box; flip: number[]; src: Box; dst: Box }
	| { t: 'svg'; url: string; w: number; h: number }

const css = (k: GpuColor) => `rgba(${Math.round(k[0] * 255)}, ${Math.round(k[1] * 255)}, ${Math.round(k[2] * 255)}, ${k[3]})`

/** Draws `r` in its own units. `false`: what it's drawn from (a picture) is loading; draw again later. */
export function drawRecipe(ctx: CanvasRenderingContext2D, r: Recipe): void | false {
	switch (r.t) {
		case 'cut':
		case 'rect': {
			ctx.beginPath()
			ctx.roundRect(r.cut.x - r.at.x, r.cut.y - r.at.y, r.cut.w, r.cut.h, r.cut.corners)
			ctx.clip()
			if (r.t === 'cut') return drawRecipe(ctx, r.inner)
			ctx.beginPath()
			ctx.roundRect(0, 0, r.w, r.h, r.radius)
			if (r.fill && r.fill[3] > 0) {
				ctx.fillStyle = css(r.fill)
				ctx.fill()
			}
			if (r.strokeWidth && r.stroke) {
				const sw = r.strokeWidth
				const ring = new Path2D()
				ring.roundRect(0, 0, r.w, r.h, r.radius)
				ring.roundRect(sw, sw, r.w - 2 * sw, r.h - 2 * sw, Math.max(0, r.radius - sw))
				ctx.fillStyle = css(r.stroke)
				ctx.fill(ring, 'evenodd')
			}
			return
		}
		case 'box': {
			if (r.path) ctx.clip(new Path2D(r.path))
			ctx.beginPath()
			ctx.roundRect(0, 0, r.w, r.h, r.radius)
			if (r.fill[3] > 0) {
				ctx.fillStyle = css(r.fill)
				ctx.fill()
			}
			if (r.gradient && r.gradientLine) {
				const g = ctx.createLinearGradient(...r.gradientLine)
				for (const stop of r.gradient.stops) g.addColorStop(Math.max(0, Math.min(1, stop.at)), stop.color)
				ctx.fillStyle = g
				ctx.fill()
			}
			const sides = r.sides
			if (!sides) return
			const [T, R, B, L] = sides.widths as [number, number, number, number]
			const { w, h, radius } = r
			const ring = new Path2D()
			ring.roundRect(0, 0, w, h, radius)
			const corner = (x: number, y: number) => ({ x: Math.max(0, radius - x), y: Math.max(0, radius - y) })
			ring.roundRect(L, T, Math.max(0, w - L - R), Math.max(0, h - T - B), [corner(L, T), corner(R, T), corner(R, B), corner(L, B)])
			const polygons = [
				[0, 0, w, 0, w - R, T, L, T],
				[w, 0, w, h, w - R, h - B, w - R, T],
				[w, h, 0, h, L, h - B, w - R, h - B],
				[0, h, 0, 0, L, T, L, h - B],
			]
			const one = sides.colors.every((c, i) => !sides.widths[i] || c === sides.colors.find((_, j) => sides.widths[j]))
			sides.colors.forEach((c, i) => {
				if (!sides.widths[i]) return
				ctx.save()
				if (!one) {
					const p = polygons[i]!
					ctx.beginPath()
					ctx.moveTo(p[0]!, p[1]!)
					for (let k = 2; k < p.length; k += 2) ctx.lineTo(p[k]!, p[k + 1]!)
					ctx.closePath()
					ctx.clip()
				}
				ctx.fillStyle = c
				ctx.fill(ring, 'evenodd')
				ctx.restore()
			})
			return
		}
		case 'dashed': {
			const ring = new Path2D()
			ring.roundRect(r.pad, r.pad, r.w, r.h, r.radius)
			ring.roundRect(r.pad + r.bw, r.pad + r.bw, r.w - 2 * r.bw, r.h - 2 * r.bw, Math.max(0, r.radius - r.bw))
			ctx.clip(ring, 'evenodd')
			ctx.setLineDash([r.dash, r.gap])
			ctx.lineWidth = r.bw * 2.2
			ctx.lineCap = 'butt'
			ctx.strokeStyle = r.css
			ctx.beginPath()
			ctx.roundRect(r.pad + r.inset, r.pad + r.inset, r.cw, r.ch, r.cr)
			ctx.stroke()
			return
		}
		case 'shadow': {
			const s = ctx.getTransform().a
			ctx.save()
			const outside = new Path2D()
			outside.rect(-1, -1, r.w + 2, r.h + 2)
			outside.roundRect(r.bx, r.by, r.bw, r.bh, r.radius)
			ctx.clip(outside, 'evenodd')
			// Shadows ignore the transform: the blur and the offset are in the canvas's own pixels.
			ctx.shadowColor = r.shade
			ctx.shadowBlur = r.blur * s
			ctx.shadowOffsetX = (r.dx + r.far) * s
			ctx.shadowOffsetY = r.dy * s
			ctx.fillStyle = '#000'
			ctx.beginPath()
			const grown = typeof r.radius === 'number' ? Math.max(0, r.radius + r.spread) : { x: Math.max(0, r.radius.x + r.spread), y: Math.max(0, r.radius.y + r.spread) }
			ctx.roundRect(r.bx - r.spread - r.far, r.by - r.spread, r.bw + r.spread * 2, r.bh + r.spread * 2, grown)
			ctx.fill()
			ctx.restore()
			return
		}
		case 'text': {
			textContext(r.style)
			ctx.textBaseline = 'alphabetic'
			ctx.textAlign = 'left'
			for (const sh of r.shadows) {
				ctx.fillStyle = sh.color
				for (const g of r.runs) ctx.fillText(g.text, g.x + sh.x, r.baseline + sh.y)
			}
			ctx.fillStyle = r.ink
			for (const g of r.runs) ctx.fillText(g.text, g.x, r.baseline)
			return
		}
		case 'img': {
			const img = decodedPicture(r.url)
			if (!img) {
				decodePicture(r.url)
				return false
			}
			// Cut to the part shown, and to the cut's corners: two clips, which meet.
			ctx.beginPath()
			ctx.rect(0, 0, r.w, r.h)
			ctx.clip()
			if (r.cut) {
				ctx.beginPath()
				ctx.roundRect(r.cut.x - r.at.x, r.cut.y - r.at.y, r.cut.w, r.cut.h, r.cut.corners)
				ctx.clip()
			}
			ctx.translate(r.b.x - r.at.x + r.b.w / 2, r.b.y - r.at.y + r.b.h / 2)
			ctx.scale(r.flip[0]!, r.flip[1]!)
			ctx.translate(-r.b.w / 2, -r.b.h / 2)
			ctx.imageSmoothingQuality = 'high'
			ctx.drawImage(img, r.src.x, r.src.y, r.src.w, r.src.h, r.dst.x, r.dst.y, r.dst.w, r.dst.h)
			return
		}
		case 'svg': {
			const img = decodedPicture(r.url)
			if (!img) {
				decodePicture(r.url)
				return false
			}
			ctx.drawImage(img, 0, 0, r.w, r.h)
			return
		}
	}
}

/**
 * Pictures decoded (an SVG's markup, an image's address), the most recently used last, up to
 * `DECODED_MAX`: an SVG is a document of its own, and keeping one for every shape ever read held
 * gigabytes on a big board. One let go is decoded again when it's next rastered.
 */
const decoded = new Map<string, HTMLImageElement>()
const DECODED_MAX = 4000
const decoding = new Map<string, Promise<void>>()
const failed = new Set<string>()

export function decodedPicture(url: string): HTMLImageElement | undefined {
	const img = decoded.get(url)
	if (img) {
		decoded.delete(url)
		decoded.set(url, img)
	}
	return img
}

/** Starts decoding `url` unless it's decoded or on its way; what to wait for, if anything. */
export function decodePicture(url: string, image?: HTMLImageElement): Promise<void> | undefined {
	if (decoded.has(url) || failed.has(url)) return undefined
	const waiting = decoding.get(url)
	if (waiting) return waiting
	const img = image ?? new Image()
	if (!image) img.src = url
	const done = img
		.decode()
		.then(() => {
			decoded.set(url, img)
			if (decoded.size > DECODED_MAX) decoded.delete(decoded.keys().next().value!)
		})
		.catch(() => {
			failed.add(url)
		})
		.finally(() => decoding.delete(url))
	decoding.set(url, done)
	return done
}

/** Whether a picture couldn't be decoded. */
export const pictureFailed = (url: string) => failed.has(url)

/** A picture the page has already decoded (an `<img>` it shows), kept for drawing without decoding it again. */
export function keepPicture(url: string, img: HTMLImageElement): void {
	if (!img.complete || !img.naturalWidth || decoded.has(url)) return
	decoded.set(url, img)
	if (decoded.size > DECODED_MAX) decoded.delete(decoded.keys().next().value!)
}
