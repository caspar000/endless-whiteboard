import { atom, computed, react, type Atom, type Computed } from '@tldraw/state'
import type { ComputedCache } from '@tldraw/store'
import type { TLShape, TLShapeId } from '@tldraw/tlschema'
import type { Editor } from '../editor/Editor'
import { getRendererMode } from '../editor/rendererMode'
import type { GpuPrimitive } from './primitives'

/** Floats per rect instance: page transform (6), rect (4), radius, stroke width, fill (4), stroke (4), opacity. */
export const RECT_FLOATS = 21

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
 *   `toGpu` and the page doesn't need it: not being edited, not clipped by a frame, and not above a
 *   shape the page draws that it overlaps (the GPU layer is under every page-drawn shape, so drawing
 *   it there would put it under one it should cover). Its element is then hidden (`Shape.tsx`).
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
	private readonly instances: ComputedCache<Float32Array, TLShape>
	/** The shapes in drawing order. (`getRenderingShapeList` is sorted by id, so page elements never move in the DOM, with each one's place in z-order as its `index`.) */
	private readonly zOrder: Computed<ReturnType<Editor['getRenderingShapeList']>>
	/** The GPU's shapes on screen, for `auto`. */
	readonly onScreen: Computed<number>
	/** Shapes the GPU could draw that lie above an overlapping page-drawn one, so the page draws them. */
	private readonly abovePage: Computed<ReadonlySet<TLShapeId>>
	/** Whether the layer should be in the page. */
	readonly wanted: Computed<boolean>
	/** Whether the layer draws its shapes (up, and not `idle`). */
	private readonly active: Computed<boolean>
	/** Every rect instance of the GPU's shapes, in drawing order, ready to upload. */
	readonly rects: Computed<{ data: Float32Array; count: number }>

	constructor(readonly editor: Editor) {
		this.budget = atom('gpu budget', readBudget())
		this.primitives = editor.store.createComputedCache('gpu primitives', (shape: TLShape) => {
			const util = editor.getShapeUtil(shape)
			if (!util.toGpu) return null
			return util.toGpu(shape, { isDarkMode: editor.user.getIsDarkMode() })
		})
		// What the GPU could draw, before the z-order rule: it has primitives and the page doesn't need it.
		this.eligible = editor.store.createComputedCache('gpu eligible', (shape: TLShape) => {
			if (!this.primitives.get(shape.id)) return false
			if (editor.isShapeBeingEdited(shape.id)) return false
			if (editor.getShapeClipPath(shape.id)) return false
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
		this.abovePage = computed('gpu above page', () => {
			if (!this.active.get()) return EMPTY
			// In drawing order: every shape the page draws marks the cells of its bounds; a shape the GPU
			// could draw that lands on a marked cell (and really overlaps what's there) goes to the page too.
			const out = new Set<TLShapeId>()
			const cells = new Map<number, { x: number; y: number; maxX: number; maxY: number }[]>()
			const keys = (b: { x: number; y: number; maxX: number; maxY: number }) => {
				const k: number[] = []
				for (let gx = Math.floor(b.x / CELL); gx <= Math.floor(b.maxX / CELL); gx++)
					for (let gy = Math.floor(b.y / CELL); gy <= Math.floor(b.maxY / CELL); gy++) k.push(gx * 73856093 + gy)
				return k
			}
			for (const { id } of this.zOrder.get()) {
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
			return this.eligible.get(shape.id) === true && !this.abovePage.get().has(shape.id)
		})
		this.instances = editor.store.createComputedCache('gpu instances', (shape: TLShape) => {
			const prims = this.primitives.get(shape.id) ?? []
			const m = editor.getShapePageTransform(shape.id)
			const out = new Float32Array(prims.length * RECT_FLOATS)
			let o = 0
			for (const p of prims) {
				if (p.kind !== 'rect') continue
				const fill = p.fill ?? TRANSPARENT
				const stroke = p.stroke ?? TRANSPARENT
				out.set([m.a, m.b, m.c, m.d, m.e, m.f, p.x, p.y, p.w, p.h, p.radius ?? 0, p.stroke ? (p.strokeWidth ?? 1) : 0, ...fill, ...stroke, 1], o)
				o += RECT_FLOATS
			}
			return o === out.length ? out : out.slice(0, o)
		})
		this.rects = computed('gpu rects', () => {
			if (!this.active.get()) return { data: new Float32Array(0), count: 0 }
			const list = this.zOrder.get()
			const parts: { data: Float32Array; opacity: number }[] = []
			let floats = 0
			for (const { id, opacity } of list) {
				if (!this.drawn.get(id)) continue
				const data = this.instances.get(id)
				if (!data?.length) continue
				parts.push({ data, opacity })
				floats += data.length
			}
			const data = new Float32Array(floats)
			let o = 0
			for (const part of parts) {
				data.set(part.data, o)
				for (let i = o + RECT_FLOATS - 1; i < o + part.data.length; i += RECT_FLOATS) data[i] = part.opacity
				o += part.data.length
			}
			return { data, count: floats / RECT_FLOATS }
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
