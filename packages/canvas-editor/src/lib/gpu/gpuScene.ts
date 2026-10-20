import { atom, computed, react, type Atom, type Computed } from '@tldraw/state'
import type { ComputedCache } from '@tldraw/store'
import type { TLShape, TLShapeId } from '@tldraw/tlschema'
import type { Editor } from '../editor/Editor'
import { getRendererMode } from '../editor/rendererMode'
import type { GpuPrimitive } from './primitives'
import { dashPolylines, flattenPath, STROKE_VERTEX_FLOATS, strokeTriangles } from './stroke'

/** Floats per rect instance: page transform (6), rect (4), radius, stroke width, fill (4), stroke (4), opacity. */
export const RECT_FLOATS = 21
/** Floats per stroke vertex: page position (2), offset (2), half width, colour (4), halo, opacity. */
export const STROKE_FLOATS = 11

/** A run of one kind of thing to draw, in drawing order: rect instances, or stroke vertices. */
export interface GpuRun {
	kind: 'rect' | 'stroke'
	first: number
	count: number
}

/** What the layer draws in a frame: every rect instance and stroke vertex, and the runs to draw them in. */
export interface GpuFrame {
	rects: Float32Array
	strokes: Float32Array
	runs: GpuRun[]
}

type Chunk = { kind: 'rect' | 'stroke'; data: Float32Array }

/**
 * Shapes the GPU could draw on screen above which `auto` turns the GPU layer on, unless
 * `localStorage['lifeboard:gpu-budget']` says otherwise (the checks set it low). It turns off again
 * below `BUDGET_OFF` of it, so a count hovering at the edge doesn't switch back and forth: each switch
 * makes or frees a WebGL context. Measured in phase 2 (docs/gpu-renderer-plan.md): the page pans at
 * the 120 fps floor up to about 70–85 shapes on screen and slower from there, so a margin under it.
 */
export const DEFAULT_GPU_BUDGET = 64
export const BUDGET_OFF = 0.7
export const GPU_BUDGET_STORAGE_KEY = 'lifeboard:gpu-budget'

/**
 * What the GPU layer draws for one editor (docs/gpu-renderer-plan.md): whether it's up at all, which
 * shapes are its, and their instance data in drawing order. Reactive and cached per shape, so the
 * camera moving recomputes nothing but the count `auto` switches on, and a shape changing recomputes
 * that shape.
 *
 * - **Up** (`wanted`): the board is shown, the browser can run it (`gpuLayerSupported`), and the
 *   renderer is `gpu`, `compare` or `idle`, or `auto` with more of the GPU's shapes on screen than
 *   the budget.
 * - **A shape is the GPU's** while the layer draws (not `idle`) when its util returns primitives from
 *   `toGpu` and the page doesn't need it: not being edited, not clipped by a frame, and not under a
 *   shape the page draws that overlaps it (the GPU layer lies over every page-drawn shape, so drawing
 *   it there would put it over one that should cover it). Its element is then hidden (`Shape.tsx`).
 */
export class GpuScene {
	/** Set by the layer: mounted with a live WebGL2 context. */
	readonly layerUp: Atom<boolean> = atom('gpu layer up', false)
	/** Set by the app: this board is the one on screen (not a tab open behind it). */
	readonly shown: Atom<boolean> = atom('gpu board shown', true)
	/** `auto` has switched the layer on (with hysteresis; see `DEFAULT_GPU_BUDGET`). */
	readonly autoOn: Atom<boolean> = atom('gpu auto on', false)
	/** How often the layer has been brought up, and how often `auto` has switched on, for the checks. */
	starts = 0
	autoSwitches = 0

	private readonly budget: Atom<number>
	private readonly primitives: ComputedCache<GpuPrimitive[] | null, TLShape>
	private readonly eligible: ComputedCache<boolean, TLShape>
	private readonly drawn: ComputedCache<boolean, TLShape>
	/** Each stroke's triangles in the shape's own space, made once per change of what it draws. */
	private readonly strokeGeometry: ComputedCache<Float32Array[], TLShape>
	/** A shape's instance data in page space, in the order its primitives draw. */
	private readonly chunks: ComputedCache<Chunk[], TLShape>
	/** Each shape's opacity, as the page applies it (its own, its ancestors', erasing). */
	private readonly opacities: Computed<ReadonlyMap<TLShapeId, number>>
	/** The shapes in drawing order. (`getRenderingShapeList` is sorted by id, so page elements never move in the DOM, with each one's place in z-order as its `index`.) */
	private readonly zOrder: Computed<ReturnType<Editor['getRenderingShapeList']>>
	/** The GPU's shapes on screen, for `auto`. */
	readonly onScreen: Computed<number>
	/** Shapes the GPU could draw that lie under an overlapping page-drawn one, so the page draws them. */
	private readonly underPage: Computed<ReadonlySet<TLShapeId>>
	/** Whether the layer should be in the page. */
	readonly wanted: Computed<boolean>
	/** Whether the layer draws its shapes (up, and not `idle`). */
	private readonly active: Computed<boolean>
	/** Everything the layer draws, in drawing order, ready to upload. */
	readonly frame: Computed<GpuFrame>

	constructor(readonly editor: Editor) {
		this.budget = atom('gpu budget', readBudget())
		this.primitives = editor.store.createComputedCache('gpu primitives', (shape: TLShape) => {
			const util = editor.getShapeUtil(shape)
			if (!util.toGpu) return null
			return util.toGpu(shape, { isDarkMode: editor.user.getIsDarkMode() })
		})
		this.opacities = computed('gpu opacities', () => new Map(editor.getRenderingShapeList().map((e) => [e.id, e.opacity])))
		// What the GPU could draw, before the z-order rule: it has primitives and the page doesn't need it.
		this.eligible = editor.store.createComputedCache('gpu eligible', (shape: TLShape) => {
			const prims = this.primitives.get(shape.id)
			if (!prims) return false
			if (editor.isShapeBeingEdited(shape.id)) return false
			if (editor.getShapeClipPath(shape.id)) return false
			// The page fades a see-through shape as one (its line over its halo, then faded); the GPU fades
			// each piece, so a halo would show through its line. One rect is the same either way; anything
			// more is the page's while see-through.
			const single = prims.length === 1 && prims[0]!.kind === 'rect'
			if (!single && (this.opacities.get().get(shape.id) ?? 1) < 1) return false
			return true
		})
		this.zOrder = computed('gpu z order', () => [...editor.getRenderingShapeList()].sort((a, b) => a.index - b.index))
		this.onScreen = computed('gpu on screen', () => {
			const culled = editor.getCulledShapeIds()
			let n = 0
			for (const { id } of editor.getRenderingShapeList()) if (!culled.has(id) && this.eligible.get(id)) n++
			return n
		})
		this.wanted = computed('gpu wanted', () => {
			if (!this.shown.get() || !gpuLayerSupported(editor)) return false
			const mode = getRendererMode()
			if (mode === 'gpu' || mode === 'compare' || mode === 'idle') return true
			return mode === 'auto' && this.autoOn.get()
		})
		this.active = computed('gpu active', () => this.wanted.get() && this.layerUp.get() && getRendererMode() !== 'idle')
		this.underPage = computed('gpu under page', () => {
			if (!this.active.get()) return EMPTY
			// From the top down: every shape the page draws marks the cells of its bounds; a shape the GPU
			// could draw that lands on a marked cell (and really overlaps what's there) goes to the page too.
			const out = new Set<TLShapeId>()
			const cells = new Map<number, { x: number; y: number; maxX: number; maxY: number }[]>()
			const keys = (b: { x: number; y: number; maxX: number; maxY: number }) => {
				const k: number[] = []
				for (let gx = Math.floor(b.x / CELL); gx <= Math.floor(b.maxX / CELL); gx++)
					for (let gy = Math.floor(b.y / CELL); gy <= Math.floor(b.maxY / CELL); gy++) k.push(gx * 73856093 + gy)
				return k
			}
			const order = this.zOrder.get()
			for (let i = order.length - 1; i >= 0; i--) {
				const { id } = order[i]!
				const b = editor.getShapePageBounds(id)
				if (!b) continue
				const box = { x: b.x, y: b.y, maxX: b.maxX, maxY: b.maxY }
				let page = !this.eligible.get(id)
				if (!page)
					page = keys(box).some((k) => cells.get(k)?.some((o) => o.x < box.maxX && box.x < o.maxX && o.y < box.maxY && box.y < o.maxY))
				if (!page) continue
				if (this.eligible.get(id)) out.add(id)
				for (const k of keys(box)) {
					const list = cells.get(k)
					if (list) list.push(box)
					else cells.set(k, [box])
				}
			}
			return out
		})
		this.drawn = editor.store.createComputedCache('gpu drawn', (shape: TLShape) => {
			if (!this.active.get()) return false
			return this.eligible.get(shape.id) === true && !this.underPage.get().has(shape.id)
		})
		this.strokeGeometry = editor.store.createComputedCache('gpu stroke geometry', (shape: TLShape) => {
			const out: Float32Array[] = []
			for (const p of this.primitives.get(shape.id) ?? []) {
				if (p.kind !== 'stroke') continue
				let lines = flattenPath(p.d)
				if (p.dash) lines = dashPolylines(lines, p.dash.array, p.dash.offset)
				out.push(new Float32Array(strokeTriangles(lines)))
			}
			return out
		})
		this.chunks = editor.store.createComputedCache('gpu chunks', (shape: TLShape) => {
			const prims = this.primitives.get(shape.id) ?? []
			const m = editor.getShapePageTransform(shape.id)
			const opacity = this.opacities.get().get(shape.id) ?? 1
			// The transform's scale, for widths; offsets keep their length of 1 at the edge.
			const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1
			const geometry = this.strokeGeometry.get(shape.id) ?? []
			const out: Chunk[] = []
			const push = (kind: Chunk['kind'], data: Float32Array) => {
				const last = out[out.length - 1]
				if (last?.kind === kind) {
					const merged = new Float32Array(last.data.length + data.length)
					merged.set(last.data)
					merged.set(data, last.data.length)
					last.data = merged
				} else out.push({ kind, data })
			}
			let g = 0
			for (const p of prims) {
				if (p.kind === 'rect') {
					const fill = p.fill ?? TRANSPARENT
					const stroke = p.stroke ?? TRANSPARENT
					push('rect', new Float32Array([m.a, m.b, m.c, m.d, m.e, m.f, p.x, p.y, p.w, p.h, p.radius ?? 0, p.stroke ? (p.strokeWidth ?? 1) : 0, ...fill, ...stroke, opacity]))
					continue
				}
				const tris = geometry[g++]
				if (!tris?.length) continue
				const verts = tris.length / STROKE_VERTEX_FLOATS
				const data = new Float32Array(verts * STROKE_FLOATS)
				const hw = (p.width / 2) * scale
				const [r, gr, b, a] = p.color
				for (let i = 0, o = 0, t = 0; i < verts; i++, o += STROKE_FLOATS, t += STROKE_VERTEX_FLOATS) {
					const x = tris[t]!
					const y = tris[t + 1]!
					const ox = tris[t + 2]!
					const oy = tris[t + 3]!
					data[o] = m.a * x + m.c * y + m.e
					data[o + 1] = m.b * x + m.d * y + m.f
					data[o + 2] = (m.a * ox + m.c * oy) / scale
					data[o + 3] = (m.b * ox + m.d * oy) / scale
					data[o + 4] = hw
					data[o + 5] = r
					data[o + 6] = gr
					data[o + 7] = b
					data[o + 8] = a
					data[o + 9] = p.halo ? 1 : 0
					data[o + 10] = opacity
				}
				push('stroke', data)
			}
			return out
		})
		this.frame = computed('gpu frame', () => {
			if (!this.active.get()) return { rects: new Float32Array(0), strokes: new Float32Array(0), runs: [] }
			const parts: Chunk[] = []
			let rectFloats = 0
			let strokeFloats = 0
			for (const { id } of this.zOrder.get()) {
				if (!this.drawn.get(id)) continue
				for (const chunk of this.chunks.get(id) ?? []) {
					parts.push(chunk)
					if (chunk.kind === 'rect') rectFloats += chunk.data.length
					else strokeFloats += chunk.data.length
				}
			}
			const rects = new Float32Array(rectFloats)
			const strokes = new Float32Array(strokeFloats)
			const runs: GpuRun[] = []
			let ro = 0
			let so = 0
			for (const part of parts) {
				const per = part.kind === 'rect' ? RECT_FLOATS : STROKE_FLOATS
				const first = (part.kind === 'rect' ? ro : so) / per
				const count = part.data.length / per
				if (part.kind === 'rect') {
					rects.set(part.data, ro)
					ro += part.data.length
				} else {
					strokes.set(part.data, so)
					so += part.data.length
				}
				const last = runs[runs.length - 1]
				if (last?.kind === part.kind && last.first + last.count === first) last.count += count
				else runs.push({ kind: part.kind, first, count })
			}
			return { rects, strokes, runs }
		})

		// `auto`: on above the budget, off below `BUDGET_OFF` of it. Only while `auto` is asked for and
		// the board is shown; otherwise the count isn't even read.
		// Nothing to count on a board none of whose shape types can be drawn by the GPU.
		const anyGpuType = Object.values(editor.shapeUtils).some((util) => !!util?.toGpu)
		const stop = react('gpu auto switch', () => {
			if (!anyGpuType || getRendererMode() !== 'auto' || !this.shown.get() || !gpuLayerSupported(editor)) {
				if (this.autoOn.get()) this.autoOn.set(false)
				return
			}
			const n = this.onScreen.get()
			const budget = this.budget.get()
			if (!this.autoOn.get() && n > budget) {
				this.autoSwitches++
				this.autoOn.set(true)
			}
			else if (this.autoOn.get() && n < budget * BUDGET_OFF) this.autoOn.set(false)
		})
		editor.disposables.add(stop)
	}

	/** Whether the GPU layer draws this shape. */
	isDrawn(id: TLShapeId): boolean {
		return this.drawn.get(id) ?? false
	}

	/** Whether this shape's element is hidden: the GPU draws it, and isn't only being compared with the page. */
	hidesElement(id: TLShapeId): boolean {
		const mode = getRendererMode()
		if (mode !== 'gpu' && mode !== 'auto') return false
		return this.isDrawn(id)
	}

	/** For the checks: a different budget, as `localStorage` would give at load. */
	setBudget(n: number): void {
		this.budget.set(n)
	}
}

const TRANSPARENT = [0, 0, 0, 0] as const
const EMPTY: ReadonlySet<TLShapeId> = new Set()
/** The z-order rule's grid, in page units. */
const CELL = 512

function readBudget(): number {
	try {
		const n = Number(globalThis.localStorage?.getItem(GPU_BUDGET_STORAGE_KEY))
		if (Number.isFinite(n) && n > 0) return n
	} catch {
		// No storage: the default.
	}
	return DEFAULT_GPU_BUDGET
}

/** Safari's engine (and every iOS browser), not Chrome's, which also says AppleWebKit. */
const IS_WEBKIT = typeof navigator !== 'undefined' && /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|Edg|OPR|jsdom/.test(navigator.userAgent)

/**
 * Whether this browser runs the GPU layer. WebKit only at pixel ratio 2 and up (docs/gpu-renderer-plan.md,
 * Risks): at 1 it snaps bordered boxes to whole pixels at 100% by a rule not yet reproduced. (Playwright's
 * WebKit also crashes with a WebGL canvas under a large board; real Safari doesn't, checked by hand.)
 */
export function gpuLayerSupported(editor: Editor): boolean {
	return !IS_WEBKIT || editor.getDevicePixelRatio() >= 2
}

const scenes = new WeakMap<Editor, GpuScene>()

/** The editor's GPU scene, made on first use. */
export function getGpuScene(editor: Editor): GpuScene {
	let scene = scenes.get(editor)
	if (!scene) scenes.set(editor, (scene = new GpuScene(editor)))
	return scene
}
