import { TLFrameShape, createShapeId } from '@lifeboard/canvas-editor'
import { TestEditor } from './TestEditor'

let editor: TestEditor
const a = createShapeId('a')
const b = createShapeId('b')
const away = createShapeId('away')

beforeEach(() => {
	editor = new TestEditor()
	editor.createShapes([
		{ id: a, type: 'geo', x: 100, y: 100, props: { w: 100, h: 100 } },
		{ id: b, type: 'geo', x: 300, y: 150, props: { w: 100, h: 100 } },
		{ id: away, type: 'geo', x: 800, y: 600, props: { w: 100, h: 100 } },
	])
})

describe('framing the selection (B4)', () => {
	it('wraps the selection with room around it, keeping where the shapes are on the page', async () => {
		const { frameSelection, removeFrame } = await import('../lib/utils/frames/frames')
		editor.select(a, b)
		const id = frameSelection(editor)!
		const frame = editor.getShape<TLFrameShape>(id)!
		expect(frame).toMatchObject({ x: 68, y: 68, props: { w: 364, h: 214 } })
		expect(editor.getShape(a)!.parentId).toBe(id)
		expect(editor.getShape(b)!.parentId).toBe(id)
		expect(editor.getShapePageBounds(a)!.minX).toBe(100)
		expect(editor.getSelectedShapeIds()).toEqual([id])

		removeFrame(editor, [id])
		expect(editor.getShape(id)).toBeUndefined()
		expect(editor.getShapePageBounds(a)!.minX).toBe(100)
	})

	it('highlights, while a frame is drawn, the shapes it will take in', () => {
		editor.setCurrentTool('frame')
		editor.pointerDown(50, 50).pointerMove(250, 250)
		expect(editor.getHintingShapeIds()).toEqual([a])
		editor.pointerMove(450, 300)
		expect([...editor.getHintingShapeIds()].sort()).toEqual([a, b].sort())
		editor.pointerUp()
		expect(editor.getHintingShapeIds()).toEqual([])
		const frame = editor.getCurrentPageShapes().find((shape) => shape.type === 'frame')!
		expect(editor.getShape(a)!.parentId).toBe(frame.id)
		expect(editor.getShape(away)!.parentId).toBe(editor.getCurrentPageId())
	})
})
