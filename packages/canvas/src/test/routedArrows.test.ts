import { TLArrowBinding, TLArrowShape, Vec2d, WAYPOINTS_META, createShapeId } from '@lifeboard/canvas-editor'
import { TestEditor } from './TestEditor'

let editor: TestEditor
const a = createShapeId('a')
const b = createShapeId('b')
const arrow = createShapeId('arrow')

const bind = (terminal: 'start' | 'end', toId: typeof a) => ({
	type: 'arrow' as const,
	fromId: arrow,
	toId,
	props: { terminal, normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false, snap: 'none' as const },
})

beforeEach(() => {
	editor = new TestEditor()
	editor.createShapes([
		{ id: a, type: 'geo', x: 0, y: 0, props: { w: 100, h: 100 } },
		{ id: b, type: 'geo', x: 400, y: 0, props: { w: 100, h: 100 } },
		// Through two waypoints below the shapes, in the arrow's own space (it sits at the origin).
		{ id: arrow, type: 'arrow', x: 0, y: 0, props: { arrowheadEnd: 'none' }, meta: { [WAYPOINTS_META]: [{ x: 50, y: 300 }, { x: 450, y: 300 }] } },
	])
	editor.createBindings<TLArrowBinding>([bind('start', a), bind('end', b)])
})

const info = () => {
	const i = editor.getArrowInfo(arrow)
	return i?.isStraight ? i : undefined
}

describe('arrows with waypoints', () => {
	it('run from their start through each waypoint to their end, meeting each shape on the way in', () => {
		expect(info()!.route!.map((p) => [Math.round(p.x), Math.round(p.y)])).toEqual([[50, 100], [50, 300], [450, 300], [450, 100]])
	})

	it('follow a shape that moves, keeping their waypoints', () => {
		editor.updateShape({ id: b, type: 'geo', x: 600, y: 0 })
		const route = info()!.route!.map((p) => [Math.round(p.x), Math.round(p.y)])
		expect(route.slice(0, 3)).toEqual([[50, 100], [50, 300], [450, 300]])
		expect(route[3]![1]).toBeLessThanOrEqual(100)
	})

	it('are hit along the route, not straight across', () => {
		const shape = editor.getShape<TLArrowShape>(arrow)!
		const geometry = editor.getShapeGeometry(shape)
		expect(geometry.hitTestPoint(new Vec2d(250, 300), 5, true)).toBe(true)
		expect(geometry.hitTestPoint(new Vec2d(250, 50), 5, true)).toBe(false)
	})

	it('have no middle handle to bend them', () => {
		const shape = editor.getShape<TLArrowShape>(arrow)!
		expect(editor.getShapeHandles(shape)!.map((h) => h.id)).toEqual(['start', 'end'])
	})

	it('without waypoints are straight again', () => {
		// `meta` merges: clearing the waypoints sets them to null.
		editor.updateShape({ id: arrow, type: 'arrow', meta: { [WAYPOINTS_META]: null } })
		expect(info()!.route).toBeUndefined()
	})

	it('ignore waypoints that are not points', () => {
		editor.updateShape({ id: arrow, type: 'arrow', meta: { [WAYPOINTS_META]: [{ x: 'a' }] } })
		expect(info()!.route).toBeUndefined()
	})
})
