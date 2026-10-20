import { RECT_FLOATS } from './gpuScene'

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

/** Draws the scene's instances; owns every WebGL object, and is thrown away with the context. */
export class GpuRenderer {
	private readonly program: WebGLProgram
	private readonly uniforms: Record<string, WebGLUniformLocation | null>
	private readonly vao: WebGLVertexArrayObject
	private readonly instanceBuffer: WebGLBuffer
	private uploaded: Float32Array | null = null
	private count = 0

	constructor(readonly gl: WebGL2RenderingContext) {
		this.program = link(gl, RECT_VS, RECT_FS)
		this.uniforms = Object.fromEntries(['u_shift', 'u_z', 'u_view', 'u_dpr'].map((n) => [n, gl.getUniformLocation(this.program, n)]))
		this.vao = gl.createVertexArray()!
		gl.bindVertexArray(this.vao)
		const corners = gl.createBuffer()!
		gl.bindBuffer(gl.ARRAY_BUFFER, corners)
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
		gl.enableVertexAttribArray(0)
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
		this.instanceBuffer = gl.createBuffer()!
		gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer)
		const stride = RECT_FLOATS * 4
		let offset = 0
		;[3, 3, 4, 2, 4, 4, 1].forEach((size, i) => {
			gl.enableVertexAttribArray(i + 1)
			gl.vertexAttribPointer(i + 1, size, gl.FLOAT, false, stride, offset)
			gl.vertexAttribDivisor(i + 1, 1)
			offset += size * 4
		})
		gl.bindVertexArray(null)
	}

	/** New instance data, uploaded only when it's a different array from last time. */
	setRects(data: Float32Array, count: number): void {
		if (data === this.uploaded) return
		const { gl } = this
		gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer)
		gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW)
		this.uploaded = data
		this.count = count
	}

	draw(view: GpuView): void {
		const { gl } = this
		gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
		gl.clearColor(0, 0, 0, 0)
		gl.clear(gl.COLOR_BUFFER_BIT)
		if (!this.count) return
		gl.enable(gl.BLEND)
		gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
		gl.useProgram(this.program)
		// The layer's translation on screen.
		const shift = (t: number) => view.z * t + 0.5 * (1 - view.z)
		gl.uniform2f(this.uniforms.u_shift!, shift(view.tx), shift(view.ty))
		gl.uniform1f(this.uniforms.u_z!, view.z)
		gl.uniform2f(this.uniforms.u_view!, view.width, view.height)
		gl.uniform1f(this.uniforms.u_dpr!, view.dpr)
		gl.bindVertexArray(this.vao)
		gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count)
		gl.bindVertexArray(null)
	}
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
