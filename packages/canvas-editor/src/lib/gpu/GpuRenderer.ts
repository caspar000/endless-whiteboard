import { ATLAS_PAD, ImageAtlas, type AtlasEntry } from './atlas'
import { RECT_FLOATS, SAMPLED_CURVES, STROKE_FLOATS, type GpuFrame, type PlacedImage } from './gpuScene'
import type { GpuColor, GpuImage } from './primitives'
import { withoutDecoding } from './recipes'

/**
 * The page-to-screen mapping of the shape layer (`Canvas.tsx`, "position layers"): a 1px element
 * transformed by `scale(z) translate(x + offset, y + offset)` about its centre (0.5, 0.5), so a page
 * point lands at `z * (p + t) + 0.5 * (1 - z)` with `t` the camera plus that offset. The GPU layer
 * uses exactly this, so its pixels fall where the page's do.
 */
export interface GpuView {
	/** Camera plus the layer's offset. */
	tx: number
	ty: number
	z: number
	/** CSS pixels of the canvas, and device pixels per CSS pixel. */
	width: number
	height: number
	dpr: number
	/** The zoom the page's `--tl-zoom` holds (it lags the camera on big boards): an arrow halo's width follows it. */
	haloZoom: number
	/** The paper's colour (`--color-background`), a halo's colour. */
	background: GpuColor
	/** The camera has been still a moment: pictures seen at another scale or position are rastered again. */
	settled: boolean
}

/** What a draw left undone: pictures still drawn from a raster at another scale or position. */
export interface GpuDrawResult {
	pending: boolean
}

const RECT_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_corner;
layout(location=1) in vec3 a_m0;   // a, b, c
layout(location=2) in vec3 a_m1;   // d, e, f
layout(location=3) in vec4 a_rect; // x, y, w, h
layout(location=4) in vec2 a_rs;   // radius, stroke width
layout(location=5) in vec4 a_fill;
layout(location=6) in vec4 a_stroke;
layout(location=7) in float a_opacity;
uniform vec2 u_shift;
uniform float u_z;
uniform vec2 u_view;
uniform float u_dpr;
out vec2 v_local;
flat out vec4 v_rect;
flat out vec2 v_rs;
flat out vec4 v_fill;
flat out vec4 v_stroke;
flat out float v_opacity;
void main() {
	// A device pixel of margin round the rect for its antialiased edge, in the shape's units.
	float margin = 1.5 / (u_z * u_dpr);
	vec2 c = (a_corner + 1.0) * 0.5;
	vec2 local = a_rect.xy - margin + (a_rect.zw + 2.0 * margin) * c;
	// The shape's page transform: [a c e; b d f]. The browser paints at the exact position, with no
	// snapping to device pixels (measured: an edge's coverage follows the camera by fractions of one).
	vec2 page = vec2(a_m0.x * local.x + a_m0.z * local.y + a_m1.y, a_m0.y * local.x + a_m1.x * local.y + a_m1.z);
	vec2 screen = u_z * page + u_shift;
	vec2 clip = screen / u_view * 2.0 - 1.0;
	gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
	v_local = local;
	v_rect = a_rect; v_rs = a_rs; v_fill = a_fill; v_stroke = a_stroke; v_opacity = a_opacity;
}`

const RECT_FS = `#version 300 es
precision highp float;
in vec2 v_local;
flat in vec4 v_rect;
flat in vec2 v_rs;
flat in vec4 v_fill;
flat in vec4 v_stroke;
flat in float v_opacity;
out vec4 o;
float roundBox(vec2 p, vec2 half_, float r) {
	vec2 q = abs(p) - half_ + r;
	return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
	vec2 half_ = v_rect.zw * 0.5;
	vec2 p = v_local - (v_rect.xy + half_);
	float r = min(v_rs.x, min(half_.x, half_.y));
	float d = roundBox(p, half_, r);
	float fw = max(fwidth(d), 1e-6);
	float outer = clamp(0.5 - d / fw, 0.0, 1.0);
	// The border lies inside the edge, as CSS draws it; its inner corners round by what's left.
	float bw = v_rs.y;
	float inner = bw > 0.0 ? clamp(0.5 - roundBox(p, half_ - bw, max(r - bw, 0.0)) / fw, 0.0, 1.0) : outer;
	vec4 fill = vec4(v_fill.rgb * v_fill.a, v_fill.a);
	vec4 stroke = vec4(v_stroke.rgb * v_stroke.a, v_stroke.a);
	// As the browser paints a box: the border over the background. Under a see-through border the
	// background runs to the outer edge; under an opaque one it stops at the border's inner edge, so it
	// can't show through the border's antialiased rim (Blink's background bleed avoidance).
	float ring = outer - inner;
	float under = bw > 0.0 && v_stroke.a >= 1.0 ? inner : outer;
	o = (stroke * ring + fill * under * (1.0 - stroke.a * ring)) * v_opacity;
}`

const STROKE_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_pos;
layout(location=1) in vec2 a_off;
layout(location=2) in float a_hw;
layout(location=3) in vec4 a_color;
layout(location=4) in float a_halo;
layout(location=5) in float a_opacity;
uniform vec2 u_shift;
uniform float u_z;
uniform vec2 u_view;
uniform float u_dpr;
uniform float u_haloZoom;
uniform vec4 u_background;
out vec2 v_off;
flat out vec2 v_across;
flat out float v_hw;
flat out float v_px;
flat out vec4 v_color;
flat out float v_sampled;
void main() {
	// a_halo: 1 for a halo, plus 2 for a curve, which Chromium covers by samples. Only a line thinner
	// than a device pixel is drawn that way here: that's where it shows (laid over each other, curves
	// don't add up), while wider, a sample's worth of difference in where an edge falls would.
	float px = 1.0 / (u_z * u_dpr);
	bool halo = mod(a_halo, 2.0) > 0.5;
	bool sampled = a_halo > 1.5 && 2.0 * a_hw < px;
	// A halo is the stroke again in the paper's colour, wider by --tl-arrow-halo each side.
	float hw = a_hw + (halo ? 2.0 * min(0.75, 1.5 / u_haloZoom) : 0.0);
	// Sampled, the triangles are the stroke's own outline; otherwise a pixel wider, for the shader's edge.
	vec2 off = a_off * (sampled ? hw : hw + px);
	vec2 page = a_pos + off;
	vec2 screen = u_z * page + u_shift;
	vec2 clip = screen / u_view * 2.0 - 1.0;
	gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
	v_off = off;
	// Which way is across the stroke here, from the vertex's own offset (a strip's edge, or a round
	// piece's rim; its centre has none and isn't the vertex a triangle takes this from).
	float ol = length(a_off);
	v_across = ol > 1e-6 ? a_off / ol : vec2(1.0, 0.0);
	v_hw = hw;
	v_px = px;
	vec4 c = halo ? u_background : a_color;
	v_color = vec4(c.rgb * c.a, c.a) * a_opacity;
	v_sampled = sampled ? 1.0 : 0.0;
}`

const STROKE_FS = `#version 300 es
precision highp float;
in vec2 v_off;
flat in vec2 v_across;
flat in float v_hw;
flat in float v_px;
flat in vec4 v_color;
flat in float v_sampled;
out vec4 o;
// The share of a pixel (a unit square) on the near side of a straight edge \`u\` pixels from its centre,
// the edge's normal leaning \`a\` (the larger of its |x| and |y|) and \`b\` (the smaller): exact, as the
// browser's rasteriser covers it. A ramp straight across the pixel is right only for a level edge.
float coverage(float u, float a, float b) {
	float hi = 0.5 * (a + b);
	if (u <= -hi) return 0.0;
	if (u >= hi) return 1.0;
	if (b < 1e-4) return clamp(0.5 + u / a, 0.0, 1.0);
	float lo = 0.5 * (a - b);
	if (u <= -lo) { float t = u + hi; return t * t / (2.0 * a * b); }
	if (u <= lo) return 0.5 + u / a;
	float t = hi - u;
	return 1.0 - t * t / (2.0 * a * b);
}
void main() {
	// Covered by the multisampled target's samples: the triangles are the edge.
	if (v_sampled > 0.5) {
		o = v_color;
		return;
	}
	// How far across the stroke this pixel lies, in pixels, and which way across is on screen.
	float r = length(v_off) / v_px;
	vec2 n = abs(v_across);
	float a = max(n.x, n.y);
	float b = min(n.x, n.y);
	float hw = v_hw / v_px;
	// The stroke is the band within hw either side: what's inside its far edge less what's past its near one.
	float cov = coverage(hw - r, a, b) - coverage(-hw - r, a, b);
	o = v_color * clamp(cov, 0.0, 1.0);
}`

const IMAGE_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_corner;
layout(location=1) in vec4 a_rect;
layout(location=2) in vec4 a_uv;
layout(location=3) in float a_opacity;
uniform vec2 u_buffer;
out vec2 v_uv;
flat out float v_opacity;
void main() {
	vec2 c = (a_corner + 1.0) * 0.5;
	vec2 p = a_rect.xy + a_rect.zw * c;
	vec2 clip = p / u_buffer * 2.0 - 1.0;
	gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
	v_uv = mix(a_uv.xy, a_uv.zw, c);
	v_opacity = a_opacity;
}`

const IMAGE_FS = `#version 300 es
precision highp float;
uniform sampler2D u_atlas;
in vec2 v_uv;
flat in float v_opacity;
out vec4 o;
void main() {
	o = texture(u_atlas, v_uv) * v_opacity;
}`

/** Floats per image instance: device rect (4), texture rect (4), opacity. */
const IMAGE_FLOATS = 9
/** Milliseconds of rastering pictures again per frame, once the camera is still. */
const RASTER_BUDGET_MS = 6

/** Draws the scene's frame; owns every WebGL object, and is thrown away with the context. */
export class GpuRenderer {
	private readonly rectProgram: WebGLProgram
	private readonly rectUniforms: Record<string, WebGLUniformLocation | null>
	private readonly rectVao: WebGLVertexArrayObject
	private readonly rectBuffer: WebGLBuffer
	private readonly strokeProgram: WebGLProgram
	private readonly strokeUniforms: Record<string, WebGLUniformLocation | null>
	private readonly strokeVao: WebGLVertexArrayObject
	private readonly strokeBuffer: WebGLBuffer
	private readonly imageProgram: WebGLProgram
	private readonly imageUniforms: Record<string, WebGLUniformLocation | null>
	private readonly imageVao: WebGLVertexArrayObject
	private readonly imageBuffer: WebGLBuffer
	private readonly atlas: ImageAtlas
	private frame: GpuFrame | null = null

	/** The multisampled target everything is drawn in and resolved from, when curves are sampled. */
	private readonly target: { framebuffer: WebGLFramebuffer; color: WebGLRenderbuffer; w: number; h: number } | null

	constructor(readonly gl: WebGL2RenderingContext) {
		const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) as number)
		this.target = SAMPLED_CURVES && samples === 4 ? { framebuffer: gl.createFramebuffer()!, color: gl.createRenderbuffer()!, w: 0, h: 0 } : null
		this.rectProgram = link(gl, RECT_VS, RECT_FS)
		this.rectUniforms = uniforms(gl, this.rectProgram, ['u_shift', 'u_z', 'u_view', 'u_dpr'])
		this.rectVao = gl.createVertexArray()!
		gl.bindVertexArray(this.rectVao)
		const corners = gl.createBuffer()!
		gl.bindBuffer(gl.ARRAY_BUFFER, corners)
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
		gl.enableVertexAttribArray(0)
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
		this.rectBuffer = gl.createBuffer()!
		for (let i = 1; i <= 7; i++) {
			gl.enableVertexAttribArray(i)
			gl.vertexAttribDivisor(i, 1)
		}
		gl.bindVertexArray(null)

		this.imageProgram = link(gl, IMAGE_VS, IMAGE_FS)
		this.imageUniforms = uniforms(gl, this.imageProgram, ['u_buffer', 'u_atlas'])
		this.imageVao = gl.createVertexArray()!
		gl.bindVertexArray(this.imageVao)
		gl.bindBuffer(gl.ARRAY_BUFFER, corners)
		gl.enableVertexAttribArray(0)
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
		this.imageBuffer = gl.createBuffer()!
		for (let i = 1; i <= 3; i++) {
			gl.enableVertexAttribArray(i)
			gl.vertexAttribDivisor(i, 1)
		}
		gl.bindVertexArray(null)
		this.atlas = new ImageAtlas(gl)

		this.strokeProgram = link(gl, STROKE_VS, STROKE_FS)
		this.strokeUniforms = uniforms(gl, this.strokeProgram, ['u_shift', 'u_z', 'u_view', 'u_dpr', 'u_haloZoom', 'u_background'])
		this.strokeVao = gl.createVertexArray()!
		gl.bindVertexArray(this.strokeVao)
		this.strokeBuffer = gl.createBuffer()!
		gl.bindBuffer(gl.ARRAY_BUFFER, this.strokeBuffer)
		let offset = 0
		;[2, 2, 1, 4, 1, 1].forEach((size, i) => {
			gl.enableVertexAttribArray(i)
			gl.vertexAttribPointer(i, size, gl.FLOAT, false, STROKE_FLOATS * 4, offset)
			offset += size * 4
		})
		gl.bindVertexArray(null)
	}

	/** A new frame, uploaded only when it's a different one from last time. */
	setFrame(frame: GpuFrame): void {
		if (frame === this.frame) return
		const { gl } = this
		if (frame.rects !== this.frame?.rects) {
			gl.bindBuffer(gl.ARRAY_BUFFER, this.rectBuffer)
			gl.bufferData(gl.ARRAY_BUFFER, frame.rects, gl.DYNAMIC_DRAW)
		}
		if (frame.strokes !== this.frame?.strokes) this.keepStrokes(frame.strokes)
		this.frame = frame
	}

	/**
	 * Each shape's stroke vertices, kept in one buffer between frames, at a place of their own: a frame
	 * sends only the arrays it hasn't seen (a shape that changed, one that came in). Sending them all
	 * again on every change was 17 MB on a board of dotted arrows, each time culling moved a shape.
	 * Once more than half of the buffer is arrays no longer drawn, it's packed again.
	 */
	private keepStrokes(parts: Float32Array[]) {
		const { gl } = this
		const pool = this.strokePool
		let live = 0
		for (const p of parts) live += p.length
		const fresh = parts.filter((p) => !pool.at.has(p))
		let more = 0
		for (const p of fresh) more += p.length
		gl.bindBuffer(gl.ARRAY_BUFFER, this.strokeBuffer)
		if (pool.used + more > pool.capacity || pool.used - (live - more) > Math.max(live, 1 << 20)) {
			// Packed again, with room to grow.
			pool.capacity = Math.max(1 << 20, live * 2)
			pool.at = new WeakMap()
			pool.used = 0
			gl.bufferData(gl.ARRAY_BUFFER, pool.capacity * 4, gl.DYNAMIC_DRAW)
			for (const p of parts) {
				if (pool.at.has(p)) continue
				gl.bufferSubData(gl.ARRAY_BUFFER, pool.used * 4, p)
				pool.at.set(p, pool.used / STROKE_FLOATS)
				pool.used += p.length
			}
			return
		}
		for (const p of fresh) {
			gl.bufferSubData(gl.ARRAY_BUFFER, pool.used * 4, p)
			pool.at.set(p, pool.used / STROKE_FLOATS)
			pool.used += p.length
		}
	}

	/** Where each stroke array is in the stroke buffer, in vertices; how much of it is used, and its size, in floats. */
	private readonly strokePool = { at: new WeakMap<Float32Array, number>(), used: 0, capacity: 0 }
	/** Pictures rastered ahead of being on screen, or tried. */
	private readonly triedAhead = new WeakSet<GpuImage>()
	/** Each placed picture's raster as last found, with the scale and phase it was found for. */
	private readonly seen = new WeakMap<PlacedImage, { scale: number; fx: number; fy: number; generation: number; entry: AtlasEntry }>()

	draw(view: GpuView): GpuDrawResult {
		const { gl } = this
		const w = gl.drawingBufferWidth
		const h = gl.drawingBufferHeight
		gl.viewport(0, 0, w, h)
		gl.clearColor(0, 0, 0, 0)
		gl.bindFramebuffer(gl.FRAMEBUFFER, null)
		gl.clear(gl.COLOR_BUFFER_BIT)
		const runs = this.frame?.runs ?? []
		if (!runs.length) return { pending: false }
		const target = this.target
		if (target) {
			// Four samples a pixel, as Chromium rasterises a curve; everything else's edges are the shaders',
			// on quads a pixel wider, so they resolve to what they'd be drawn straight to the canvas.
			if (target.w !== w || target.h !== h) {
				gl.bindRenderbuffer(gl.RENDERBUFFER, target.color)
				gl.renderbufferStorageMultisample(gl.RENDERBUFFER, 4, gl.RGBA8, w, h)
				gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer)
				gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, target.color)
				target.w = w
				target.h = h
			}
			gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer)
			gl.clear(gl.COLOR_BUFFER_BIT)
		}
		const { images: imageRuns, pending } = this.placeImages(view)
		gl.enable(gl.BLEND)
		gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
		// The layer's translation on screen.
		const shift = (t: number) => view.z * t + 0.5 * (1 - view.z)
		const common = (u: Record<string, WebGLUniformLocation | null>) => {
			gl.uniform2f(u.u_shift!, shift(view.tx), shift(view.ty))
			gl.uniform1f(u.u_z!, view.z)
			gl.uniform2f(u.u_view!, view.width, view.height)
			gl.uniform1f(u.u_dpr!, view.dpr)
		}
		gl.useProgram(this.strokeProgram)
		common(this.strokeUniforms)
		gl.uniform1f(this.strokeUniforms.u_haloZoom!, view.haloZoom)
		gl.uniform4f(this.strokeUniforms.u_background!, ...view.background)
		gl.useProgram(this.rectProgram)
		common(this.rectUniforms)
		let program: WebGLProgram = this.rectProgram
		for (const run of runs) {
			if (run.kind === 'rect') {
				if (program !== this.rectProgram) gl.useProgram((program = this.rectProgram))
				gl.bindVertexArray(this.rectVao)
				// WebGL2 has no base instance: the instance attributes are pointed at the run's first.
				gl.bindBuffer(gl.ARRAY_BUFFER, this.rectBuffer)
				let offset = run.first * RECT_FLOATS * 4
				;[3, 3, 4, 2, 4, 4, 1].forEach((size, i) => {
					gl.vertexAttribPointer(i + 1, size, gl.FLOAT, false, RECT_FLOATS * 4, offset)
					offset += size * 4
				})
				gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, run.count)
			} else if (run.kind === 'stroke') {
				if (program !== this.strokeProgram) gl.useProgram((program = this.strokeProgram))
				gl.bindVertexArray(this.strokeVao)
				// Each array where the buffer keeps it; neighbours in the buffer in one call.
				let start = -1
				let count = 0
				for (let i = run.first; i < run.first + run.count; i++) {
					const part = this.frame!.strokes[i]!
					const at = this.strokePool.at.get(part)
					if (at === undefined) continue
					const n = part.length / STROKE_FLOATS
					if (start >= 0 && at === start + count) count += n
					else {
						if (count) gl.drawArrays(gl.TRIANGLES, start, count)
						start = at
						count = n
					}
				}
				if (count) gl.drawArrays(gl.TRIANGLES, start, count)
			} else {
				const placed = imageRuns.get(run)
				if (!placed || !placed.count) continue
				if (program !== this.imageProgram) gl.useProgram((program = this.imageProgram))
				gl.uniform2f(this.imageUniforms.u_buffer!, gl.drawingBufferWidth, gl.drawingBufferHeight)
				gl.uniform1i(this.imageUniforms.u_atlas!, 0)
				gl.activeTexture(gl.TEXTURE0)
				gl.bindTexture(gl.TEXTURE_2D, this.atlas.texture)
				gl.bindVertexArray(this.imageVao)
				gl.bindBuffer(gl.ARRAY_BUFFER, this.imageBuffer)
				let offset = placed.first * IMAGE_FLOATS * 4
				;[4, 4, 1].forEach((size, i) => {
					gl.vertexAttribPointer(i + 1, size, gl.FLOAT, false, IMAGE_FLOATS * 4, offset)
					offset += size * 4
				})
				gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, placed.count)
			}
		}
		gl.bindVertexArray(null)
		if (target) {
			gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target.framebuffer)
			gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
			gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST)
			gl.bindFramebuffer(gl.FRAMEBUFFER, null)
		}
		return { pending }
	}

	/**
	 * Where each picture on screen lands this frame, in device pixels, and the part of the atlas it
	 * shows: rastered at this scale and sub-pixel position when it is (or is new, or the camera is
	 * still and there's time), else the last raster stretched to fit.
	 */
	private placeImages(view: GpuView): { images: Map<GpuFrame['runs'][number], { first: number; count: number }>; pending: boolean } {
		const out = new Map<GpuFrame['runs'][number], { first: number; count: number }>()
		const frame = this.frame
		if (!frame?.images.length) return { images: out, pending: false }
		const { z, dpr } = view
		const shiftX = z * view.tx + 0.5 * (1 - z)
		const shiftY = z * view.ty + 0.5 * (1 - z)
		const bw = this.gl.drawingBufferWidth
		const bh = this.gl.drawingBufferHeight
		const started = performance.now()
		// Fine enough that a glyph lands in the same quarter pixel as the page's, coarse enough that float noise is the same phase.
		const q = (f: number) => Math.round(f * 4096) / 4096
		const size = this.atlas.size
		let data: number[] = []
		let pending = false
		// Twice at most: the atlas filling up partway starts it again empty, and what was placed before that points at nothing.
		for (let attempt = 0; attempt < 2; attempt++) {
			const generation = this.atlas.generation
			data = []
			pending = false
			out.clear()
			// Pictures near the screen never rastered yet, for when the camera is still (see below).
			const ahead: { image: GpuImage; scale: number; fx: number; fy: number }[] = []
			for (const run of frame.runs) {
				if (run.kind !== 'image') continue
				const first = data.length / IMAGE_FLOATS
				for (let i = run.first; i < run.first + run.count; i++) {
					const placed = frame.images[i]!
					const { image, m, opacity } = placed
					// Pictures of unrotated shapes only (the snapshot that makes them asks for that).
					if (m[1] !== 0 || m[2] !== 0) continue
					const scale = z * dpr * m[0]
					const devX = (z * (m[0] * image.x + m[4]) + shiftX) * dpr
					const devY = (z * (m[3] * image.y + m[5]) + shiftY) * dpr
					const w = image.w * scale
					const h = image.h * scale
					const fx = q(devX - Math.floor(devX))
					const fy = q(devY - Math.floor(devY))
					if (devX + w + ATLAS_PAD < 0 || devY + h + ATLAS_PAD < 0 || devX - ATLAS_PAD > bw || devY - ATLAS_PAD > bh) {
						if (view.settled && !this.triedAhead.has(image) && !this.atlas.latest(image)) ahead.push({ image, scale, fx, fy })
						continue
					}
					// Where it was found last frame, if it's still at that scale and phase: a pan by whole device
					// pixels keeps every picture's, and looking each up by its phase was most of a frame's work.
					const seen = this.seen.get(placed)
					let entry: AtlasEntry | undefined
					if (seen && seen.scale === scale && seen.fx === fx && seen.fy === fy && seen.generation === this.atlas.generation) entry = seen.entry
					else {
						entry = this.atlas.get(image, scale, fx, fy)
						if (!entry) {
							const latest = this.atlas.latest(image)
							// New, or the camera has stopped and there's time this frame: raster it as it's seen.
							if (!latest || (view.settled && performance.now() - started < RASTER_BUDGET_MS)) entry = this.atlas.raster(image, scale, fx, fy)
							if (!entry) {
								entry = latest
								pending = true
							}
						}
						if (entry && entry.scale === scale && entry.fx === fx && entry.fy === fy) this.seen.set(placed, { scale, fx, fy, generation: this.atlas.generation, entry })
					}
					if (!entry) continue
					// Texel u of the raster is the shape's (u - pad - fx) / scale; on screen, devX + that × scale now.
					const k = scale / entry.scale
					data.push(
						devX - (ATLAS_PAD + entry.fx) * k,
						devY - (ATLAS_PAD + entry.fy) * k,
						entry.w * k,
						entry.h * k,
						entry.x / size,
						entry.y / size,
						(entry.x + entry.w) / size,
						(entry.y + entry.h) / size,
						opacity
					)
				}
				out.set(run, { first, count: data.length / IMAGE_FLOATS - first })
			}
			if (this.atlas.generation !== generation) continue
			// The camera still, the pictures on screen done and time left: those around the screen that have
			// never been rastered, at this zoom, so the pan that brings them in has them. New on screen, a
			// picture is rastered at once, whatever it costs: the first pan across a big board rastered
			// thousands. Only while the atlas has room, so they never push out what's on screen.
			for (const { image, scale, fx, fy } of ahead) {
				if (performance.now() - started >= RASTER_BUDGET_MS || !this.atlas.hasRoom()) break
				// Once, and only if it's decoded: one that isn't waits until it's on screen.
				this.triedAhead.add(image)
				withoutDecoding(() => this.atlas.raster(image, scale, fx, fy, false))
				pending = true
			}
			break
		}
		this.atlas.upload()
		const { gl } = this
		gl.bindBuffer(gl.ARRAY_BUFFER, this.imageBuffer)
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW)
		return { images: out, pending }
	}
}

function uniforms(gl: WebGL2RenderingContext, program: WebGLProgram, names: string[]) {
	return Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(program, n)]))
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
	const program = gl.createProgram()!
	for (const [type, source] of [
		[gl.VERTEX_SHADER, vs],
		[gl.FRAGMENT_SHADER, fs],
	] as const) {
		const shader = gl.createShader(type)!
		gl.shaderSource(shader, source)
		gl.compileShader(shader)
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(`GPU layer shader: ${gl.getShaderInfoLog(shader)}`)
		gl.attachShader(program, shader)
	}
	gl.linkProgram(program)
	if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`GPU layer program: ${gl.getProgramInfoLog(program)}`)
	return program
}
