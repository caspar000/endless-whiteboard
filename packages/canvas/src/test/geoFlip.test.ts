import { Group2d, TLGeoShape, createShapeId } from '@lifeboard/canvas-editor'
import { TestEditor } from './TestEditor'

let editor: TestEditor
const id = createShapeId('shape')

beforeEach(() => {
	editor = new TestEditor()
})

const outline = () => {
	const geometry = editor.getShapeGeometry(id)
	return (geometry instanceof Group2d ? geometry.children[0] : geometry).vertices.map((v) => [v.x, v.y])
}

describe('flipped geo shapes (D5)', () => {
	it('mirrors the outline within the box, either way', () => {
		editor.createShapes([{ id, type: 'geo', props: { geo: 'triangle', w: 100, h: 80 } }])
		expect(outline()).toEqual([[50, 0], [100, 80], [0, 80]])
		editor.updateShape<TLGeoShape>({ id, type: 'geo', props: { flipY: true } })
		expect(outline()).toEqual([[50, 80], [100, 0], [0, 0]])

		editor.updateShape<TLGeoShape>({ id, type: 'geo', props: { geo: 'arrow-right', flipY: false, flipX: true } })
		// The point is on the left now.
		expect(Math.min(...outline().map(([x]) => x))).toBe(0)
		expect(outline().find(([, y]) => y === 40)).toEqual([0, 40])
	})

	it('mirrors a check box’s tick', () => {
		const tick = () => {
			const geometry = editor.getShapeGeometry(id) as Group2d
			return geometry.children.slice(2).flatMap((line) => line.vertices.map((v) => [v.x, v.y]))
		}
		editor.createShapes([{ id, type: 'geo', props: { geo: 'check-box', w: 100, h: 100 } }])
		const plain = tick()
		editor.updateShape<TLGeoShape>({ id, type: 'geo', props: { flipX: true } })
		expect(plain).toHaveLength(4)
		expect(tick()).toEqual(plain.map(([x, y]) => [100 - x!, y]))
	})

	it('toggles a flip when resized past the opposite edge, and when flipped', () => {
		editor.createShapes([{ id, type: 'geo', x: 0, y: 0, props: { geo: 'triangle', w: 100, h: 80 } }])
		editor.resizeShape(id, { x: -1, y: 1 }, { scaleOrigin: { x: 50, y: 40 } })
		expect(editor.getShape<TLGeoShape>(id)!.props).toMatchObject({ flipX: true, flipY: false, w: 100 })
		editor.flipShapes([id], 'horizontal')
		editor.flipShapes([id], 'vertical')
		expect(editor.getShape<TLGeoShape>(id)).toMatchObject({ x: 0, y: 0, props: { flipX: false, flipY: true } })
	})
})
