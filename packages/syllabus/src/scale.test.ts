import { SCALE_META_KEY, createNodeShapeUtil, type Extension } from '@lifeboard/node-kit'
import { describe, expect, it } from 'vitest'
import { syllabusExtension } from './extension'

/*
 * DARK-7 on The syllabus's own cards: Shift on a handle scales each of them, a plain drag resizes it. Each
 * definition goes through the shape util the board makes of it, asked by a select tool that is
 * resizing.
 */

type Resized = { props: { w: number; h: number }; meta?: Record<string, unknown> }
type Util = { onResize(shape: unknown, info: unknown): Resized }

function drag(def: Extension['nodes'][number], shift: boolean): Resized {
	const shape = { id: 'shape:a', type: def.type, x: 0, y: 0, rotation: 0, props: { ...(def.defaultProps() as object), ...def.defaultSize }, meta: {} }
	const editor = { inputs: { shiftKey: shift }, isIn: (path: string) => path === 'select.resizing', getShape: () => shape }
	const Util = createNodeShapeUtil(def) as unknown as new (editor: unknown) => Util
	// A corner pulled out to twice the width and half again the height.
	return new Util(editor).onResize(shape, {
		newPoint: { x: 0, y: 0 },
		handle: 'bottom_right',
		mode: 'resize_bounds',
		scaleX: 2,
		scaleY: 1.5,
		initialBounds: { x: 0, y: 0, w: def.defaultSize.w, h: def.defaultSize.h },
		initialShape: shape,
	})
}

describe("The syllabus's cards", () => {
	for (const def of syllabusExtension.nodes) {
		it(`${def.label}: Shift scales it, box and content together`, () => {
			const out = drag(def, true)
			expect(out.meta?.[SCALE_META_KEY]).toBe(1.5)
			expect(out.props.w).toBeCloseTo(def.defaultSize.w * 1.5)
			expect(out.props.h).toBeCloseTo(def.defaultSize.h * 1.5)
		})

		it(`${def.label}: without Shift it resizes, and keeps its scale`, () => {
			const out = drag(def, false)
			expect(out.meta?.[SCALE_META_KEY]).toBeUndefined()
			expect(out.props.w).toBeCloseTo(def.defaultSize.w * 2)
		})
	}
})
