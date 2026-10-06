import { TLArrowBinding, TLArrowShape, createShapeId } from '@lifeboard/canvas-editor'
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
		{ id: a, type: 'geo', x: 0, y: 0, props: { w: 120, h: 80 } },
		{ id: b, type: 'geo', x: 300, y: 150, props: { w: 120, h: 80 } },
		{ id: arrow, type: 'arrow', x: 0, y: 0, props: { kind: 'elbow', start: { x: 0, y: 0 }, end: { x: 1, y: 1 } } },
	])
	editor.createBindings<TLArrowBinding>([bind('start', a), bind('end', b)])
})

const route = () => {
	const info = editor.getArrowInfo(arrow)
	return info?.isStraight ? info.route?.map((p) => [p.x, p.y]) : undefined
}

describe('elbow arrows (D4)', () => {
	it('route between the shapes they join, out of one side and into the other', () => {
		expect(route()).toEqual([[120, 40], [210, 40], [210, 190], [286.5, 190]])
	})

	it('follow the shapes when they move', () => {
		editor.updateShape({ id: b, type: 'geo', x: 300, y: 0 })
		expect(route()).toEqual([[120, 40], [286.5, 40]])
	})

	it('move their middle run with the middle handle', () => {
		const shape = editor.getShape<TLArrowShape>(arrow)!
		const middle = editor.getShapeHandles(shape)!.find((h) => h.id === 'middle')!
		expect([middle.x, middle.y]).toEqual([210, 115])
		const change = editor.getShapeUtil(shape).onHandleChange!(shape, {
			handle: { ...middle, x: 156 },
			isPrecise: false,
		})
		expect(change).toMatchObject({ props: { elbowMidPoint: 0.2 } })
	})

	it('export with rounded corners', async () => {
		const svg = await editor.getSvg([arrow])
		expect(svg!.outerHTML).toMatch(/<path[^>]*d="M120,40L203,40Q210,40 210,47/)
	})
})
