import {
	TLGeoShape,
	TLNoteShape,
	TLRichText,
	TLShapeId,
	TLTextShape,
	createShapeId,
	toRichText,
} from '@lifeboard/canvas-editor'
import { TestEditor } from './TestEditor'

/**
 * Phase 4 of docs/canvas-fork-plan.md: labels are rich text. Editing itself is TipTap's and is
 * exercised in the lab's Playwright tests; these cover what the shapes do with the result.
 */

const doc = (...content: object[]) => ({ type: 'doc', content }) as unknown as TLRichText
const p = (value: string, ...marks: string[]) => ({
	type: 'paragraph',
	content: [{ type: 'text', text: value, ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}) }],
})
const list = (...items: string[]) => ({
	type: 'bulletList',
	content: items.map((item) => ({ type: 'listItem', content: [p(item)] })),
})

let editor: TestEditor
const id = createShapeId('label')

beforeEach(() => {
	editor = new TestEditor()
})
afterEach(() => {
	editor?.dispose()
})

/** Ends an edit the way the select tool does, which is when shapes tidy their labels. */
function editAndFinish(shapeId: TLShapeId, richText: TLRichText, type: string) {
	editor.select(shapeId).setEditingShape(shapeId).setCurrentTool('select.editing_shape')
	editor.updateShapes([{ id: shapeId, type, props: { richText } }])
	editor.setCurrentTool('select.idle')
}

describe('a text shape', () => {
	it('is as tall as its rich text: a line per paragraph and per list item', () => {
		editor.createShapes([{ id, type: 'text', props: { richText: toRichText('one') } }])
		const oneLine = editor.getShapePageBounds(id)!.h
		editor.updateShapes([{ id, type: 'text', props: { richText: doc(p('one'), list('two', 'three')) } }])
		expect(editor.getShapePageBounds(id)!.h).toBeCloseTo(oneLine * 3)
	})

	it('keeps its formatting when an edit is tidied, and undo brings back the edit before', () => {
		editor.createShapes([{ id, type: 'text', props: { richText: toRichText('plain') } }])
		editor.mark('edit')
		editAndFinish(id, doc(p('bold  ', 'bold'), { type: 'paragraph' }), 'text')

		expect(editor.getShape<TLTextShape>(id)!.props.richText).toEqual(doc(p('bold', 'bold')))
		editor.undo()
		expect(editor.getShape<TLTextShape>(id)!.props.richText).toEqual(toRichText('plain'))
	})

	it('is deleted when an edit leaves it empty', () => {
		editor.createShapes([{ id, type: 'text', props: { richText: toRichText('soon gone') } }])
		editAndFinish(id, doc({ type: 'paragraph' }), 'text')
		expect(editor.getShape(id)).toBeUndefined()
	})
})

describe('shape labels', () => {
	it('grow a geo shape to fit their rich text', () => {
		editor.createShapes([{ id, type: 'geo', props: { w: 100, h: 50 } }])
		editor.updateShapes([{ id, type: 'geo', props: { richText: doc(p('a'), list('b', 'c', 'd')) } }])
		expect(editor.getShape<TLGeoShape>(id)!.props.growY).toBeGreaterThan(0)
	})

	it('grow a note to fit their rich text', () => {
		editor.createShapes([{ id, type: 'note' }])
		const lines = Array.from({ length: 12 }, (_, i) => `line ${i}`)
		editor.updateShapes([{ id, type: 'note', props: { richText: doc(list(...lines)) } }])
		expect(editor.getShape<TLNoteShape>(id)!.props.growY).toBeGreaterThan(0)
	})

	it('keep their formatting when an edit is tidied', () => {
		editor.createShapes([{ id, type: 'geo', props: { w: 200, h: 200 } }])
		editAndFinish(id, doc(list('one', 'two   ')), 'geo')
		expect(editor.getShape<TLGeoShape>(id)!.props.richText).toEqual(doc(list('one', 'two')))
	})
})
