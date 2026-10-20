import { RECT_FLOATS, STROKE_FLOATS, type GpuFrame } from './gpuScene'
import type { GpuColor } from './primitives'

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
void main() {
	// A halo is the stroke again in the paper's colour, wider by --tl-arrow-halo each side.
	float hw = a_hw + (a_halo > 0.5 ? 2.0 * min(0.75, 1.5 / u_haloZoom) : 0.0);
	float px = 1.0 / (u_z * u_dpr);
	vec2 off = a_off * (hw + px);
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
	vec4 c = a_halo > 0.5 ? u_background : a_color;
	v_color = vec4(c.rgb * c.a, c.a) * a_opacity;
}`

const STROKE_FS = `#version 300 es
precision highp float;
in vec2 v_off;
flat in vec2 v_across;
flat in float v_hw;
flat in float v_px;
flat in vec4 v_color;
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
	private frame: GpuFrame | null = null

	constructor(readonly gl: WebGL2RenderingContext) {
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
		if (frame.strokes !== this.frame?.strokes) {
			gl.bindBuffer(gl.ARRAY_BUFFER, this.strokeBuffer)
			gl.bufferData(gl.ARRAY_BUFFER, frame.strokes, gl.DYNAMIC_DRAW)
		}
		this.frame = frame
	}

	draw(view: GpuView): void {
		const { gl } = this
		gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
		gl.clearColor(0, 0, 0, 0)
		gl.clear(gl.COLOR_BUFFER_BIT)
		const runs = this.frame?.runs ?? []
		if (!runs.length) return
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
			} else {
				if (program !== this.strokeProgram) gl.useProgram((program = this.strokeProgram))
				gl.bindVertexArray(this.strokeVao)
				gl.drawArrays(gl.TRIANGLES, run.first, run.count)
			}
		}
		gl.bindVertexArray(null)
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
