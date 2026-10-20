import { atom, computed, type Atom, type Computed } from '@tldraw/state'
import type { ComputedCache } from '@tldraw/store'
import type { TLShape, TLShapeId } from '@tldraw/tlschema'
import type { Editor } from '../editor/Editor'
import { getRendererMode } from '../editor/rendererMode'
import type { GpuPrimitive } from './primitives'

/** Floats per rect instance: page transform (6), rect (4), radius, stroke width, fill (4), stroke (4), opacity. */
export const RECT_FLOATS = 21

/**
 * What the GPU layer draws for one editor (docs/gpu-renderer-plan.md): which shapes are its, and
 * their instance data in drawing order. Everything here is reactive and cached per shape, so the
 * camera moving recomputes nothing and a shape changing recomputes that shape.
 *
 * A shape is the GPU's when the renderer is `gpu`, the layer is up (mounted, context not lost), the
 * shape's util returns primitives from `toGpu`, and the page doesn't need it: not being edited, not
 * clipped by a frame (clipping comes later). Its element is then hidden (`Shape.tsx`), still laid out.
 */
export class GpuScene {
	/** Set by the layer: mounted with a live WebGL2 context. */
	readonly layerUp: Atom<boolean> = atom('gpu layer up', false)

	private readonly primitives: ComputedCache<GpuPrimitive[] | null, TLShape>
	private readonly drawn: ComputedCache<boolean, TLShape>
	private readonly instances: ComputedCache<Float32Array, TLShape>
	private readonly active: Computed<boolean>
	/** Every rect instance of the GPU's shapes, in drawing order, ready to upload. */
	readonly rects: Computed<{ data: Float32Array; count: number }>

	constructor(readonly editor: Editor) {
		this.active = computed('gpu active', () => {
			const mode = getRendererMode()
			if (mode !== 'gpu' && mode !== 'compare') return false
			if (!GPU_LAYER_SUPPORTED) return false
			return this.layerUp.get()
		})
		this.primitives = editor.store.createComputedCache('gpu primitives', (shape: TLShape) => {
			const util = editor.getShapeUtil(shape)
			if (!util.toGpu) return null
			return util.toGpu(shape, { isDarkMode: editor.user.getIsDarkMode() })
		})
		this.drawn = editor.store.createComputedCache('gpu drawn', (shape: TLShape) => {
			if (!this.active.get()) return false
			if (!this.primitives.get(shape.id)) return false
			if (editor.isShapeBeingEdited(shape.id)) return false
			if (editor.getShapeClipPath(shape.id)) return false
			return true
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
			const list = editor.getRenderingShapeList()
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
	}

	/** Whether the GPU layer draws this shape. */
	isDrawn(id: TLShapeId): boolean {
		return this.drawn.get(id) ?? false
	}

	/** Whether this shape's element is hidden: the GPU draws it, and isn't only being compared with the page. */
	hidesElement(id: TLShapeId): boolean {
		return getRendererMode() === 'gpu' && this.isDrawn(id)
	}
}

const TRANSPARENT = [0, 0, 0, 0] as const

/** Safari's engine (and every iOS browser), not Chrome's, which also says AppleWebKit. */
const IS_WEBKIT = typeof navigator !== 'undefined' && /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|Edg|OPR|jsdom/.test(navigator.userAgent)

/**
 * Where the GPU layer runs. Not in WebKit for now (docs/gpu-renderer-plan.md, Risks): Playwright's
 * WebKit crashes with any WebGL canvas under the four-tree board panned at 10%, an empty one included,
 * and at pixel ratio 1 it snaps bordered boxes at 100% by a rule not yet reproduced. There the page
 * draws everything, as it always has.
 */
export const GPU_LAYER_SUPPORTED = !IS_WEBKIT

const scenes = new WeakMap<Editor, GpuScene>()

/** The editor's GPU scene, made on first use. */
export function getGpuScene(editor: Editor): GpuScene {
	let scene = scenes.get(editor)
	if (!scene) scenes.set(editor, (scene = new GpuScene(editor)))
	return scene
}
