import type { GpuPrimitive } from './primitives'
import { restored, storable } from './snapshotCache'

const picture = (recipe?: unknown): GpuPrimitive => ({ kind: 'image', x: 0, y: 0, w: 10, h: 10, key: 'k', draw: () => undefined, ...(recipe ? { recipe } : {}) }) as GpuPrimitive

describe('what the GPU layer keeps between sessions', () => {
	it('keeps rects and pictures with a recipe, without their draw', () => {
		const rect: GpuPrimitive = { kind: 'rect', x: 0, y: 0, w: 4, h: 4, fill: [1, 0, 0, 1] }
		const stored = storable([rect, picture({ t: 'svg', url: 'data:image/svg+xml,x', w: 10, h: 10 })])!
		expect(stored).toHaveLength(2)
		expect('draw' in stored[1]!).toBe(false)
		// Storable as IndexedDB stores things.
		expect(() => structuredClone(stored)).not.toThrow()
	})

	it("doesn't keep a picture without a recipe, or one of an object URL", () => {
		expect(storable([picture()])).toBeNull()
		expect(storable([picture({ t: 'img', url: 'blob:http://x/1', w: 1, h: 1, cut: null, at: { x: 0, y: 0 }, b: { x: 0, y: 0, w: 1, h: 1 }, flip: [1, 1], src: { x: 0, y: 0, w: 1, h: 1 }, dst: { x: 0, y: 0, w: 1, h: 1 } })])).toBeNull()
		expect(storable([picture({ t: 'cut', cut: { x: 0, y: 0, w: 1, h: 1, corners: [] }, at: { x: 0, y: 0 }, inner: { t: 'svg', url: 'blob:http://x/2', w: 1, h: 1 } })])).toBeNull()
	})

	it('gives pictures back a draw from their recipe', () => {
		const back = restored(storable([picture({ t: 'svg', url: 'data:image/svg+xml,x', w: 10, h: 10 })])!)
		expect(back[0]!.kind).toBe('image')
		expect(typeof (back[0] as { draw: unknown }).draw).toBe('function')
	})
})
