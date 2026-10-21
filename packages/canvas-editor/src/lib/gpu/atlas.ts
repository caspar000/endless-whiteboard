import type { GpuImage } from './primitives'

/**
 * The GPU layer's pictures (docs/gpu-renderer-plan.md, phase 4): one texture holding each image as
 * the browser draws it, at the scale and sub-pixel position it was last seen at, so that drawn where
 * it was rastered, its texels land on the screen's pixels one for one and the result is the browser's
 * own pixels. Packed in shelves; when full it starts again empty.
 */

/** Device pixels of room round each picture, for what spills past its box (a glyph's overhang). */
export const ATLAS_PAD = 3
/** Device pixels of a shelf drawn at once before it's sent to the texture; a taller picture goes on its own. */
const STAGE_HEIGHT = 512

export interface AtlasEntry {
	/** Where it is in the texture, in texels. */
	x: number
	y: number
	w: number
	h: number
	/** Device pixels per unit of the shape, and the picture's origin's fraction of a device pixel, when rastered. */
	scale: number
	fx: number
	fy: number
}

export class ImageAtlas {
	readonly size: number
	readonly texture: WebGLTexture
	/** Each raster, by picture, scale and phase: shapes sharing a picture at different sub-pixel positions each get theirs. */
	private readonly entries = new Map<string, AtlasEntry>()
	/** The last raster of each picture, at whatever scale and phase: what's drawn, stretched, until an exact one is made. */
	private readonly latestOf = new Map<string, AtlasEntry>()
	private shelfY = 0
	private shelfH = 0
	private cursorX = 0
	/** The part of a shelf rastered and not yet sent to the texture: its row, from x0 to x1, so tall. */
	private staged: { y: number; x0: number; x1: number; h: number } | null = null
	/** Bumped when the atlas starts again empty: everything in it is gone. */
	generation = 0

	constructor(readonly gl: WebGL2RenderingContext) {
		this.size = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number)
		this.texture = gl.createTexture()!
		gl.bindTexture(gl.TEXTURE_2D, this.texture)
		gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, this.size, this.size)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
	}

	/** The picture rastered at exactly this scale and phase. */
	get(key: string, scale: number, fx: number, fy: number): AtlasEntry | undefined {
		return this.entries.get(at(key, scale, fx, fy))
	}

	/** The picture as last rastered, at whatever scale and phase. */
	latest(key: string): AtlasEntry | undefined {
		return this.latestOf.get(key)
	}

	/**
	 * Rasters `image` at `scale` device pixels per unit with its origin `fx`, `fy` into a device pixel,
	 * and keeps it under `key`. Undefined when it doesn't fit even in an empty atlas. It's in the texture
	 * once `upload` has run: the pictures of a shelf are drawn side by side in one canvas and sent in one
	 * go, since thousands of uploads in a frame (a board zoomed out, every picture new) ran the GPU out
	 * of memory.
	 */
	raster(key: string, image: GpuImage, scale: number, fx: number, fy: number): AtlasEntry | undefined {
		const w = Math.ceil(image.w * scale + fx) + ATLAS_PAD * 2
		const h = Math.ceil(image.h * scale + fy) + ATLAS_PAD * 2
		if (w > this.size || h > this.size) return undefined
		let slot = this.place(w, h)
		if (!slot) {
			this.clear()
			slot = this.place(w, h)
			if (!slot) return undefined
		}
		const { canvas, ctx } = rasterCanvas()
		const tall = h > STAGE_HEIGHT
		if (this.staged && (tall || this.staged.y !== slot.y)) this.upload()
		if (canvas.width !== this.size || canvas.height < STAGE_HEIGHT) {
			canvas.width = this.size
			canvas.height = STAGE_HEIGHT
		}
		if (tall && canvas.height < h) canvas.height = h
		if (!this.staged) {
			ctx.setTransform(1, 0, 0, 1, 0, 0)
			ctx.clearRect(0, 0, canvas.width, canvas.height)
			this.staged = { y: slot.y, x0: slot.x, x1: slot.x, h: 0 }
		}
		ctx.save()
		ctx.setTransform(scale, 0, 0, scale, slot.x + ATLAS_PAD + fx, ATLAS_PAD + fy)
		image.draw(ctx)
		ctx.restore()
		this.staged.x1 = slot.x + w
		this.staged.h = Math.max(this.staged.h, h)
		if (tall) {
			this.upload()
			canvas.height = STAGE_HEIGHT
		}
		const entry = { x: slot.x, y: slot.y, w, h, scale, fx, fy }
		this.entries.set(at(key, scale, fx, fy), entry)
		this.latestOf.set(key, entry)
		return entry
	}

	/** Sends what's been rastered since the last time to the texture. */
	upload() {
		const staged = this.staged
		if (!staged) return
		this.staged = null
		const { gl } = this
		const { canvas } = rasterCanvas()
		gl.bindTexture(gl.TEXTURE_2D, this.texture)
		// Straight from the canvas, which keeps its pixels premultiplied: reading them back would
		// un-premultiply them, and premultiplying again rounds the soft edges differently.
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
		gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, staged.x0)
		gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0)
		gl.texSubImage2D(gl.TEXTURE_2D, 0, staged.x0, staged.y, staged.x1 - staged.x0, staged.h, gl.RGBA, gl.UNSIGNED_BYTE, canvas)
		gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0)
	}

	private place(w: number, h: number): { x: number; y: number } | null {
		if (this.cursorX + w > this.size) {
			this.shelfY += this.shelfH
			this.shelfH = 0
			this.cursorX = 0
		}
		if (this.shelfY + h > this.size) return null
		const at = { x: this.cursorX, y: this.shelfY }
		this.cursorX += w
		this.shelfH = Math.max(this.shelfH, h)
		return at
	}

	private clear() {
		// What's staged belongs to the atlas being thrown away.
		this.staged = null
		this.entries.clear()
		this.latestOf.clear()
		this.shelfY = 0
		this.shelfH = 0
		this.cursorX = 0
		this.generation++
	}
}

const at = (key: string, scale: number, fx: number, fy: number) => `${key}|${scale}|${fx}|${fy}`

let raster: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null
/**
 * The canvas pictures are drawn in, shared, and in the document though out of sight: a canvas draws
 * text with its own element's `-webkit-font-smoothing`, which a detached one doesn't have, and text
 * drawn smoothed comes out heavier than the page's.
 */
export function rasterCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
	if (raster?.canvas.isConnected) return raster
	const canvas = raster?.canvas ?? document.createElement('canvas')
	canvas.setAttribute('aria-hidden', 'true')
	canvas.style.cssText = 'position:fixed;left:-100000px;top:0;width:1px;height:1px;pointer-events:none;visibility:hidden'
	document.body.appendChild(canvas)
	return (raster = { canvas, ctx: raster?.ctx ?? canvas.getContext('2d')! })
}
