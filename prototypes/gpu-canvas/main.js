// GPU canvas prototype: the four-tree board drawn with WebGL2 in batches, to measure what a GPU
// renderer would give the whiteboard (docs: the research in the session of 2026-10-20).
//
// One instanced draw per kind of thing (discs, rings, line segments, glyphs) per copy of the board.
// `?copies=N` lays N copies out in a grid, to stand in for boards of N × 3,490 shapes. Copies off
// screen are skipped; text under half a pixel high and line detail under half a pixel are
// skipped too, which leaves the picture as it was.

const SHAPES_PER_COPY = 3490
const params = new URLSearchParams(location.search)
const copies = Math.max(1, Number(params.get('copies') ?? 1))
const sceneName = params.get('scene') ?? 'four-trees'

const canvas = document.getElementById('c')
const hud = document.getElementById('hud')
const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: true, alpha: false })
if (!gl) throw new Error('WebGL2 is not available')

const scene = await (await fetch(`data/${sceneName}.json`)).json()
// Lines from shapes the export found hidden (culled) came out with nonsense positions: dropped.
{
	const xs = scene.discs.map((d) => d[0]), ys = scene.discs.map((d) => d[1])
	const [x0, x1, y0, y1] = [Math.min(...xs) - 2000, Math.max(...xs) + 2000, Math.min(...ys) - 2000, Math.max(...ys) + 2000]
	scene.lines = scene.lines.filter((l) => {
		const p = l[6]
		for (let i = 0; i < p.length; i += 2) if (p[i] < x0 || p[i] > x1 || p[i + 1] < y0 || p[i + 1] > y1) return false
		return true
	})
}

// ---- Shaders

const COMMON = `#version 300 es
precision highp float;
uniform vec2 u_cam;
uniform float u_z;
uniform vec2 u_view;
uniform float u_dpr;
uniform vec2 u_offset;
vec4 toClip(vec2 world) {
	vec2 s = (world + u_offset + u_cam) * u_z;
	vec2 c = s / u_view * 2.0 - 1.0;
	return vec4(c.x, -c.y, 0.0, 1.0);
}
`

function program(vs, fs) {
	const p = gl.createProgram()
	for (const [type, src] of [
		[gl.VERTEX_SHADER, COMMON + vs],
		[gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float;\n' + fs],
	]) {
		const s = gl.createShader(type)
		gl.shaderSource(s, src)
		gl.compileShader(s)
		if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src)
		gl.attachShader(p, s)
	}
	gl.linkProgram(p)
	if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p))
	const uniforms = {}
	for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i++) {
		const { name } = gl.getActiveUniform(p, i)
		uniforms[name] = gl.getUniformLocation(p, name)
	}
	return { p, uniforms }
}

// Discs: fill and border (dashed for nodes in reach), worked out per pixel.
const discProgram = program(
	`
layout(location=0) in vec2 a_corner;
layout(location=1) in vec2 a_c;
layout(location=2) in float a_r;
layout(location=3) in vec4 a_fill;
layout(location=4) in vec4 a_border;
layout(location=5) in float a_bw;
layout(location=6) in float a_dash;
out vec2 v_p; out float v_r; out vec4 v_fill; out vec4 v_border; out float v_bw; out float v_dash;
void main() {
	float half_ = a_r + 1.0 / (u_z * u_dpr);
	v_p = a_corner * half_;
	v_r = a_r; v_fill = a_fill; v_border = a_border; v_bw = a_bw; v_dash = a_dash;
	gl_Position = toClip(a_c + v_p);
}`,
	`
in vec2 v_p; in float v_r; in vec4 v_fill; in vec4 v_border; in float v_bw; in float v_dash;
out vec4 o;
void main() {
	float d = length(v_p) - v_r;
	float fw = max(fwidth(d), 1e-6);
	float outer = clamp(0.5 - d / fw, 0.0, 1.0);
	float inner = clamp(0.5 - (d + v_bw) / fw, 0.0, 1.0);
	float border = outer - inner;
	if (v_dash > 0.5) {
		float a = atan(v_p.y, v_p.x) * v_r;
		border *= step(0.5, fract(a / (v_bw * 6.0)));
	}
	vec4 f = vec4(v_fill.rgb * v_fill.a, v_fill.a);
	vec4 b = vec4(v_border.rgb * v_border.a, v_border.a);
	o = f * inner + b * border;
}`,
)

// Rings: a track or a progress arc from the top, clockwise, with round ends.
const ringProgram = program(
	`
layout(location=0) in vec2 a_corner;
layout(location=1) in vec2 a_c;
layout(location=2) in float a_r;
layout(location=3) in float a_w;
layout(location=4) in vec4 a_col;
layout(location=5) in float a_frac;
out vec2 v_p; out float v_r; out float v_w; out vec4 v_col; out float v_frac;
void main() {
	float half_ = a_r + a_w + 1.0 / (u_z * u_dpr);
	v_p = a_corner * half_;
	v_r = a_r; v_w = a_w; v_col = a_col; v_frac = a_frac;
	gl_Position = toClip(a_c + v_p);
}`,
	`
in vec2 v_p; in float v_r; in float v_w; in vec4 v_col; in float v_frac;
out vec4 o;
const float TAU = 6.28318530718;
void main() {
	float d = abs(length(v_p) - v_r) - v_w * 0.5;
	if (v_frac < 0.999) {
		float a = atan(v_p.x, -v_p.y);
		if (a < 0.0) a += TAU;
		float end = v_frac * TAU;
		vec2 p0 = vec2(0.0, -v_r);
		vec2 p1 = vec2(sin(end), -cos(end)) * v_r;
		float caps = min(length(v_p - p0), length(v_p - p1)) - v_w * 0.5;
		d = a <= end ? min(d, caps) : caps;
	}
	float fw = max(fwidth(d), 1e-6);
	float cov = clamp(0.5 - d / fw, 0.0, 1.0);
	o = vec4(v_col.rgb * v_col.a, v_col.a) * cov;
}`,
)

// Line segments: capsules, so joins and ends are round. Thinner than a pixel, a line is drawn a
// pixel wide and fainter, as the browser does.
const lineProgram = program(
	`
layout(location=0) in vec2 a_corner;
layout(location=1) in vec2 a_p0;
layout(location=2) in vec2 a_p1;
layout(location=3) in float a_hw;
layout(location=4) in vec4 a_col;
out vec2 v_p; flat out vec2 v_p0; flat out vec2 v_p1; flat out float v_hw; flat out vec4 v_col;
void main() {
	float px = 1.0 / (u_z * u_dpr);
	float hw = max(a_hw, 0.5 * px);
	float fade = min(1.0, a_hw / (0.5 * px));
	vec2 d = a_p1 - a_p0;
	float len = length(d);
	vec2 dir = len > 0.0 ? d / len : vec2(1.0, 0.0);
	vec2 n = vec2(-dir.y, dir.x);
	float ext = hw + px;
	vec2 p = (a_corner.x < 0.5 ? a_p0 - dir * ext : a_p1 + dir * ext) + n * a_corner.y * ext;
	v_p = p; v_p0 = a_p0; v_p1 = a_p1; v_hw = hw; v_col = vec4(a_col.rgb, a_col.a * fade);
	gl_Position = toClip(p);
}`,
	`
in vec2 v_p; flat in vec2 v_p0; flat in vec2 v_p1; flat in float v_hw; flat in vec4 v_col;
out vec4 o;
void main() {
	vec2 pa = v_p - v_p0, ba = v_p1 - v_p0;
	float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
	float d = length(pa - ba * h) - v_hw;
	float fw = max(fwidth(d), 1e-6);
	float cov = clamp(0.5 - d / fw, 0.0, 1.0);
	o = vec4(v_col.rgb * v_col.a, v_col.a) * cov;
}`,
)

// Glyphs from an atlas drawn once with the browser's own font.
const textProgram = program(
	`
layout(location=0) in vec2 a_corner;
layout(location=1) in vec4 a_rect;
layout(location=2) in vec4 a_uv;
layout(location=3) in vec4 a_col;
out vec2 v_uv; flat out vec4 v_col;
void main() {
	vec2 c = (a_corner + 1.0) * 0.5;
	v_uv = mix(a_uv.xy, a_uv.zw, c);
	v_col = a_col;
	gl_Position = toClip(a_rect.xy + a_rect.zw * c);
}`,
	`
uniform sampler2D u_atlas;
in vec2 v_uv; flat in vec4 v_col;
out vec4 o;
void main() {
	float a = texture(u_atlas, v_uv).a * v_col.a;
	o = vec4(v_col.rgb * a, a);
}`,
)

// ---- Buffers

const quad = gl.createBuffer()
gl.bindBuffer(gl.ARRAY_BUFFER, quad)
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
const segQuad = gl.createBuffer()
gl.bindBuffer(gl.ARRAY_BUFFER, segQuad)
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]), gl.STATIC_DRAW)

/** A VAO of instances: `layout` is the attribute sizes from location 1 on. */
function instances(corners, data, layout) {
	const vao = gl.createVertexArray()
	gl.bindVertexArray(vao)
	gl.bindBuffer(gl.ARRAY_BUFFER, corners)
	gl.enableVertexAttribArray(0)
	gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
	const buf = gl.createBuffer()
	gl.bindBuffer(gl.ARRAY_BUFFER, buf)
	gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
	const stride = layout.reduce((a, b) => a + b, 0) * 4
	let offset = 0
	layout.forEach((size, i) => {
		gl.enableVertexAttribArray(i + 1)
		gl.vertexAttribPointer(i + 1, size, gl.FLOAT, false, stride, offset)
		gl.vertexAttribDivisor(i + 1, 1)
		offset += size * 4
	})
	gl.bindVertexArray(null)
	return { vao, count: data.length / (stride / 4), bytes: data.byteLength }
}

const discs = instances(quad, new Float32Array(scene.discs.flat()), [2, 1, 4, 4, 1, 1])
const rings = instances(quad, new Float32Array(scene.rings.flat()), [2, 1, 1, 4, 1])

// Lines, simplified per level: a level drops detail smaller than its tolerance (world units), and
// the one drawn is the coarsest whose tolerance is under half a pixel, so nothing shows.
function simplify(pts, tol) {
	const n = pts.length / 2
	if (n <= 2 || tol <= 0) return pts
	const keep = new Uint8Array(n)
	keep[0] = keep[n - 1] = 1
	const stack = [[0, n - 1]]
	while (stack.length) {
		const [a, b] = stack.pop()
		const ax = pts[a * 2], ay = pts[a * 2 + 1], bx = pts[b * 2], by = pts[b * 2 + 1]
		const dx = bx - ax, dy = by - ay
		const len = Math.hypot(dx, dy) || 1
		let worst = -1, at = -1
		for (let i = a + 1; i < b; i++) {
			const d = Math.abs((pts[i * 2] - ax) * dy - (pts[i * 2 + 1] - ay) * dx) / len
			if (d > worst) [worst, at] = [d, i]
		}
		if (worst > tol) {
			keep[at] = 1
			stack.push([a, at], [at, b])
		}
	}
	const out = []
	for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1])
	return out
}
const LEVELS = [0, 0.5, 2, 8, 32, 128, 512, 2048]
const lineLevels = LEVELS.map((tol) => {
	const data = []
	for (const [w, r, g, b, a, , pts] of scene.lines) {
		const p = simplify(pts, tol)
		for (let i = 0; i + 3 < p.length; i += 2) data.push(p[i], p[i + 1], p[i + 2], p[i + 3], w / 2, r, g, b, a)
	}
	return { tol, ...instances(segQuad, new Float32Array(data), [2, 2, 1, 4]) }
})

// The glyph atlas.
const ATLAS_FONT = 48
const PAD = 6
const chars = new Set()
for (const t of scene.texts) for (const ch of t[9]) chars.add(ch)
const atlasCanvas = document.createElement('canvas')
const actx = atlasCanvas.getContext('2d')
const glyphs = new Map()
{
	const W = 2048
	let x = 0, y = 0, rowH = 0
	const placed = []
	for (const weight of [400, 600]) {
		actx.font = `${weight} ${ATLAS_FONT}px ${scene.font}`
		const m = actx.measureText('Hg')
		const ascent = m.fontBoundingBoxAscent, descent = m.fontBoundingBoxDescent
		for (const ch of chars) {
			const adv = actx.measureText(ch).width
			const cw = Math.ceil(adv) + PAD * 2, ch_ = Math.ceil(ascent + descent) + PAD * 2
			if (x + cw > W) [x, y, rowH] = [0, y + rowH, 0]
			placed.push({ weight, ch, x, y, cw, chH: ch_, adv, ascent })
			x += cw
			rowH = Math.max(rowH, ch_)
		}
	}
	atlasCanvas.width = W
	atlasCanvas.height = 1 << Math.ceil(Math.log2(y + rowH))
	actx.fillStyle = '#fff'
	actx.textBaseline = 'alphabetic'
	for (const g of placed) {
		actx.font = `${g.weight} ${ATLAS_FONT}px ${scene.font}`
		actx.fillText(g.ch, g.x + PAD, g.y + PAD + g.ascent)
		glyphs.set(`${g.weight}${g.ch}`, { ...g, u0: g.x / W, v0: g.y / atlasCanvas.height, u1: (g.x + g.cw) / W, v1: (g.y + g.chH) / atlasCanvas.height })
	}
}
const atlas = gl.createTexture()
gl.bindTexture(gl.TEXTURE_2D, atlas)
gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlasCanvas)
gl.generateMipmap(gl.TEXTURE_2D)
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
let maxFont = 0
const glyphData = []
for (const [x, top, , size, bold, r, g, b, a, str] of scene.texts) {
	maxFont = Math.max(maxFont, size)
	const s = size / ATLAS_FONT
	let pen = x
	for (const ch of str) {
		const gl_ = glyphs.get(`${bold ? 600 : 400}${ch}`)
		if (!gl_) continue
		if (ch !== ' ') glyphData.push(pen - PAD * s, top - PAD * s, gl_.cw * s, gl_.chH * s, gl_.u0, gl_.v0, gl_.u1, gl_.v1, r, g, b, a)
		pen += gl_.adv * s
	}
}
const text = instances(quad, new Float32Array(glyphData), [4, 4, 4])

// ---- The board's bounds and the copies

let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
for (const d of scene.discs) {
	minX = Math.min(minX, d[0] - d[2]); maxX = Math.max(maxX, d[0] + d[2])
	minY = Math.min(minY, d[1] - d[2]); maxY = Math.max(maxY, d[1] + d[2])
}
for (const l of scene.lines) {
	const p = l[6]
	for (let i = 0; i < p.length; i += 2) {
		minX = Math.min(minX, p[i]); maxX = Math.max(maxX, p[i])
		minY = Math.min(minY, p[i + 1]); maxY = Math.max(maxY, p[i + 1])
	}
}
const bw = maxX - minX, bh = maxY - minY
const cols = Math.ceil(Math.sqrt(copies))
const GAP = Math.max(bw, bh) * 0.08
const offsets = []
for (let i = 0; i < copies; i++) offsets.push([(i % cols) * (bw + GAP), Math.floor(i / cols) * (bh + GAP)])
const world = { x: minX, y: minY, w: (cols - 1) * (bw + GAP) + bw, h: (Math.ceil(copies / cols) - 1) * (bh + GAP) + bh }

// ---- A spatial index for hovering: a uniform grid over one copy's discs.

const CELL = 200
const grid = new Map()
scene.discs.forEach((d, i) => {
	for (let gx = Math.floor((d[0] - d[2]) / CELL); gx <= Math.floor((d[0] + d[2]) / CELL); gx++)
		for (let gy = Math.floor((d[1] - d[2]) / CELL); gy <= Math.floor((d[1] + d[2]) / CELL); gy++) {
			const k = gx * 100003 + gy
			grid.set(k, [...(grid.get(k) ?? []), i])
		}
})
function hitTest(px, py) {
	// Which copy, then the grid of that copy.
	const cx = Math.floor((px - minX) / (bw + GAP)), cy = Math.floor((py - minY) / (bh + GAP))
	const copy = cy * cols + cx
	if (cx < 0 || cx >= cols || copy < 0 || copy >= copies) return null
	const [ox, oy] = offsets[copy]
	const lx = px - ox, ly = py - oy
	for (const i of grid.get(Math.floor(lx / CELL) * 100003 + Math.floor(ly / CELL)) ?? []) {
		const d = scene.discs[i]
		if (Math.hypot(lx - d[0], ly - d[1]) <= d[2]) return { copy, i, x: d[0] + ox, y: d[1] + oy, r: d[2] }
	}
	return null
}
const hoverBuf = gl.createBuffer()
const hoverVao = gl.createVertexArray()
gl.bindVertexArray(hoverVao)
gl.bindBuffer(gl.ARRAY_BUFFER, quad)
gl.enableVertexAttribArray(0)
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
gl.bindBuffer(gl.ARRAY_BUFFER, hoverBuf)
gl.bufferData(gl.ARRAY_BUFFER, 9 * 4, gl.DYNAMIC_DRAW)
;[2, 1, 1, 4, 1].reduce((off, size, i) => {
	gl.enableVertexAttribArray(i + 1)
	gl.vertexAttribPointer(i + 1, size, gl.FLOAT, false, 9 * 4, off * 4)
	gl.vertexAttribDivisor(i + 1, 1)
	return off + size
}, 0)
gl.bindVertexArray(null)
let hover = null

// ---- Camera and drawing

const cam = { x: 0, y: 0, z: 1 }
let dpr = 1, vw = 1, vh = 1
function resize() {
	dpr = window.devicePixelRatio || 1
	vw = innerWidth
	vh = innerHeight
	canvas.width = Math.round(vw * dpr)
	canvas.height = Math.round(vh * dpr)
	requestRender()
}

// GPU time per frame, where the browser offers a timer.
const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2')
const queries = []
const stats = { gpuMs: null, gpuSamples: [], frames: 0, last: 0, fps: 0, cpuMs: 0, drawCalls: 0, copiesDrawn: 0, level: 0, text: true }
let scheduled = false
/** Passes left out, to measure what each costs. */
const skip = new Set()
function requestRender() {
	if (scheduled) return
	scheduled = true
	requestAnimationFrame(render)
}

function use({ p, uniforms }, offset) {
	gl.useProgram(p)
	gl.uniform2f(uniforms.u_cam, cam.x, cam.y)
	gl.uniform1f(uniforms.u_z, cam.z)
	gl.uniform2f(uniforms.u_view, vw, vh)
	gl.uniform1f(uniforms.u_dpr, dpr)
	gl.uniform2f(uniforms.u_offset, offset[0], offset[1])
	return uniforms
}

function render(now) {
	scheduled = false
	const t0 = performance.now()
	// Read back finished timings, start this frame's.
	while (timer && queries.length && gl.getQueryParameter(queries[0], gl.QUERY_RESULT_AVAILABLE)) {
		const q = queries.shift()
		if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) {
			stats.gpuMs = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6
			stats.gpuSamples.push(stats.gpuMs)
		}
		gl.deleteQuery(q)
	}
	const query = timer && gl.createQuery()
	if (query) gl.beginQuery(timer.TIME_ELAPSED_EXT, query)
	gl.viewport(0, 0, canvas.width, canvas.height)
	const bg = scene.background
	gl.clearColor(bg[0], bg[1], bg[2], 1)
	gl.clear(gl.COLOR_BUFFER_BIT)
	gl.enable(gl.BLEND)
	gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

	// What's on screen, in world units.
	const view = { x0: -cam.x, y0: -cam.y, x1: -cam.x + vw / cam.z, y1: -cam.y + vh / cam.z }
	const visible = offsets.filter(([ox, oy]) => ox + maxX >= view.x0 && ox + minX <= view.x1 && oy + maxY >= view.y0 && oy + minY <= view.y1)
	const halfPx = 0.5 / (cam.z * dpr)
	const lines = [...lineLevels].reverse().find((l) => l.tol <= halfPx) ?? lineLevels[0]
	const showText = maxFont * cam.z >= 0.5
	let calls = 0

	const pass = (prog, vao, count, prim, verts) => {
		if (!count || skip.has(prog)) return
		for (const off of visible) {
			const u = use(prog, off)
			if (prog === textProgram) gl.uniform1i(u.u_atlas, 0)
			gl.bindVertexArray(vao)
			gl.drawArraysInstanced(prim, 0, verts, count)
			calls++
		}
	}
	pass(lineProgram, lines.vao, lines.count, gl.TRIANGLE_STRIP, 4)
	pass(discProgram, discs.vao, discs.count, gl.TRIANGLE_STRIP, 4)
	pass(ringProgram, rings.vao, rings.count, gl.TRIANGLE_STRIP, 4)
	if (showText) {
		gl.activeTexture(gl.TEXTURE0)
		gl.bindTexture(gl.TEXTURE_2D, atlas)
		pass(textProgram, text.vao, text.count, gl.TRIANGLE_STRIP, 4)
	}
	if (hover) {
		use(ringProgram, [0, 0])
		gl.bindBuffer(gl.ARRAY_BUFFER, hoverBuf)
		gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array([hover.x, hover.y, hover.r + 4, 3, 0.42, 0.55, 1, 1, 1]))
		gl.bindVertexArray(hoverVao)
		gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, 1)
	}
	gl.bindVertexArray(null)
	if (query) {
		gl.endQuery(timer.TIME_ELAPSED_EXT)
		queries.push(query)
	}

	stats.cpuMs = performance.now() - t0
	stats.drawCalls = calls
	stats.copiesDrawn = visible.length
	stats.level = lines.tol
	stats.text = showText
	stats.frames++
	if (now - stats.last > 500) {
		stats.fps = (stats.frames * 1000) / (now - stats.last)
		stats.frames = 0
		stats.last = now
		hud.textContent = [
			`${(copies * SHAPES_PER_COPY).toLocaleString()} shapes (${copies} × ${SHAPES_PER_COPY})`,
			`${stats.fps.toFixed(0)} fps · gpu ${stats.gpuMs?.toFixed(2) ?? '?'} ms · encode ${stats.cpuMs.toFixed(2)} ms · ${calls} draws · ${visible.length} copies on screen`,
			`zoom ${(cam.z * 100).toFixed(cam.z < 0.01 ? 3 : 1)}% · lines at ${lines.tol} · text ${showText ? 'on' : 'under ½ px'}`,
		].join('\n')
	}
}

function zoomToFit() {
	const z = Math.min(vw / world.w, vh / world.h) * 0.95
	cam.z = z
	cam.x = vw / 2 / z - (world.x + world.w / 2)
	cam.y = vh / 2 / z - (world.y + world.h / 2)
	requestRender()
}

// Pan by dragging or scrolling; zoom with ctrl/pinch or the wheel with a modifier.
let drag = null
canvas.addEventListener('pointerdown', (e) => {
	drag = { x: e.clientX, y: e.clientY }
	canvas.setPointerCapture(e.pointerId)
})
canvas.addEventListener('pointermove', (e) => {
	if (drag) {
		cam.x += (e.clientX - drag.x) / cam.z
		cam.y += (e.clientY - drag.y) / cam.z
		drag = { x: e.clientX, y: e.clientY }
		requestRender()
		return
	}
	const t0 = performance.now()
	const h = hitTest(e.clientX / cam.z - cam.x, e.clientY / cam.z - cam.y)
	stats.hitMs = performance.now() - t0
	if ((h && h.copy) !== (hover && hover.copy) || (h && h.i) !== (hover && hover.i)) {
		hover = h
		requestRender()
	}
})
canvas.addEventListener('pointerup', () => (drag = null))
canvas.addEventListener(
	'wheel',
	(e) => {
		e.preventDefault()
		if (e.ctrlKey || e.metaKey || e.altKey) {
			const f = Math.exp(-e.deltaY * 0.01)
			const px = e.clientX / cam.z - cam.x, py = e.clientY / cam.z - cam.y
			cam.z *= f
			cam.x = e.clientX / cam.z - px
			cam.y = e.clientY / cam.z - py
		} else {
			cam.x -= e.deltaX / cam.z
			cam.y -= e.deltaY / cam.z
		}
		requestRender()
	},
	{ passive: false },
)
addEventListener('resize', resize)
resize()
zoomToFit()

window.proto = {
	getCamera: () => ({ ...cam }),
	setCamera: (c) => {
		Object.assign(cam, c)
		requestRender()
	},
	zoomToFit,
	/** The middle of the first copy at zoom `z`. */
	focus: (z) => {
		cam.z = z
		cam.x = vw / 2 / z - (minX + bw / 2)
		cam.y = vh / 2 / z - (minY + bh / 2)
		requestRender()
	},
	hitTest,
	stats,
	sizes: () => ({
		discs: discs.count,
		rings: rings.count,
		glyphs: text.count,
		segments: lineLevels.map((l) => l.count),
		gpuBytesPerCopy: discs.bytes + rings.bytes + text.bytes + lineLevels.reduce((n, l) => n + l.bytes, 0),
	}),
	skip: (names) => {
		skip.clear()
		for (const n of names) skip.add({ lines: lineProgram, discs: discProgram, rings: ringProgram, text: textProgram }[n])
		requestRender()
	},
	ready: true,
}
