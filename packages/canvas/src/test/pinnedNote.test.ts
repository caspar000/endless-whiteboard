import { DefaultColorStyle, TLNoteShape, createShapeId, toRichText } from '@lifeboard/canvas-editor'
import { NoteShapeTool } from '../lib/shapes/note/NoteShapeTool'
import { TLPinnedNoteShape } from '../lib/shapes/note/PinnedNoteShapeUtil'
import { TestEditor } from './TestEditor'

/** A pinned note is its own shape: larger than a sticky, with a sticky's props. */

let editor: TestEditor
beforeEach(() => {
	editor = new TestEditor()
})
afterEach(() => {
	editor?.dispose()
})

const doc = (...lines: string[]) =>
	({
		type: 'doc',
		content: [{ type: 'bulletList', content: lines.map((text) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })) }],
	}) as unknown as TLNoteShape['props']['richText']

describe('a pinned note', () => {
	it('is its own shape type in the schema, next to the sticky note', () => {
		const sequences = Object.keys((editor.store.schema.serialize() as { sequences: object }).sequences)
		expect(sequences).toContain('com.tldraw.shape.pinned-note')
		expect(sequences).toContain('com.tldraw.shape.note')
	})

	it('is 300 wide where a sticky is 200, and grows with its text the same way', () => {
		const sticky = createShapeId('sticky')
		const pinned = createShapeId('pinned')
		editor.createShapes([
			{ id: sticky, type: 'note', props: { richText: toRichText('hi') } },
			{ id: pinned, type: 'pinned-note', props: { richText: toRichText('hi') } },
		])
		expect(editor.getShapePageBounds(sticky)!.w).toBe(200)
		expect(editor.getShapePageBounds(pinned)!.w).toBe(300)

		const before = editor.getShapePageBounds(pinned)!.h
		const lines = Array.from({ length: 16 }, (_, i) => `line ${i}`)
		editor.updateShapes([{ id: pinned, type: 'pinned-note', props: { richText: doc(...lines) } }])
		expect(editor.getShape<TLPinnedNoteShape>(pinned)!.props.growY).toBeGreaterThan(0)
		expect(editor.getShapePageBounds(pinned)!.h).toBeGreaterThan(before)
	})

	it('is placed by its own tool, centred where you click', () => {
		editor.setCurrentTool('pinned-note')
		editor.pointerDown(500, 500).pointerUp(500, 500)
		const placed = editor.getCurrentPageShapes().find((shape) => shape.type === 'pinned-note')!
		const bounds = editor.getShapePageBounds(placed.id)!
		expect(bounds.center.x).toBeCloseTo(500)
		expect(bounds.center.y).toBeCloseTo(500)
	})

	it('starts as a white card written from the top left, whatever colour the other tools draw in', () => {
		editor.setStyleForNextShapes(DefaultColorStyle, 'blue')
		editor.setCurrentTool('pinned-note')
		editor.pointerDown(500, 500).pointerUp(500, 500)
		const pinned = editor.getCurrentPageShapes().find((shape) => shape.type === 'pinned-note')!
		expect((pinned as TLPinnedNoteShape).props).toMatchObject({ color: 'white', align: 'start', verticalAlign: 'start' })
	})
})

describe('a sticky note', () => {
	it('starts yellow, whatever colour the other tools draw in', () => {
		editor.setStyleForNextShapes(DefaultColorStyle, 'blue')
		editor.setCurrentTool('note')
		editor.pointerDown(300, 300).pointerUp(300, 300)
		const sticky = editor.getCurrentPageShapes().find((shape) => shape.type === 'note')!
		expect((sticky as TLNoteShape).props.color).toBe('yellow')
	})

	it('keeps the colour picked for stickies apart from the pinned note’s', () => {
		;(editor.getStateDescendant('note') as NoteShapeTool).color.set('green')
		editor.setCurrentTool('note')
		editor.pointerDown(300, 300).pointerUp(300, 300)
		editor.setCurrentTool('pinned-note')
		editor.pointerDown(700, 300).pointerUp(700, 300)
		const colors = Object.fromEntries(editor.getCurrentPageShapes().map((shape) => [shape.type, (shape as TLNoteShape).props.color]))
		expect(colors).toEqual({ note: 'green', 'pinned-note': 'white' })
	})
})
