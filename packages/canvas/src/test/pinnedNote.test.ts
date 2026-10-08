import { DefaultColorStyle, TLNoteShape, createShapeId, toRichText } from '@lifeboard/canvas-editor'
import { NoteShapeTool } from '../lib/shapes/note/NoteShapeTool'
import { TLPinnedNoteShape } from '../lib/shapes/note/PinnedNoteShapeUtil'
import { pinPlacement } from '../lib/shapes/note/paper'
import { PinColorStyle, getPinPaint } from '../lib/shapes/note/pin'
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

	it('takes any proportion: a wide one stays wide until its text needs more room', () => {
		const id = createShapeId('wide')
		editor.createShapes([{ id, type: 'pinned-note', props: { richText: toRichText(''), paperHeight: 100 } }])
		expect(editor.getShapePageBounds(id)!).toMatchObject({ w: 300, h: 100 })

		const lines = Array.from({ length: 16 }, (_, i) => `line ${i}`)
		editor.updateShapes([{ id, type: 'pinned-note', props: { richText: doc(...lines) } }])
		expect(editor.getShapePageBounds(id)!.h).toBeGreaterThan(100)
	})

	it('resizes freely: its width scales it, its height is its paper’s', () => {
		const id = createShapeId('resized')
		editor.createShapes([{ id, type: 'pinned-note', x: 0, y: 0, props: { richText: toRichText('') } }])
		editor.select(id)
		editor.pointerDown(150, 300, { target: 'selection', handle: 'bottom' })
		editor.pointerMove(150, 150)
		editor.pointerUp()
		const shape = editor.getShape<TLPinnedNoteShape>(id)!
		expect(shape.props).toMatchObject({ scale: 1, paperHeight: 150 })
		expect(editor.getShapePageBounds(id)!).toMatchObject({ w: 300, h: 150 })
	})

	it('comes up square, as it was, from a board written before pinned notes had a paper height', () => {
		const schema = editor.store.schema.serialize() as { schemaVersion: number; sequences: Record<string, number> }
		const before = { ...schema, sequences: { ...schema.sequences, 'com.tldraw.shape.pinned-note': 1 } }
		const old = editor.store.schema.migratePersistedRecord(
			{
				id: createShapeId('old'),
				typeName: 'shape',
				type: 'pinned-note',
				x: 0,
				y: 0,
				rotation: 0,
				index: 'a1',
				parentId: editor.getCurrentPageId(),
				isLocked: false,
				opacity: 1,
				meta: {},
				props: { ...editor.getShapeUtil('pinned-note').getDefaultProps(), paperHeight: undefined },
			} as never,
			before as never
		)
		expect(old.type).toBe('success')
		expect((old as { value: TLPinnedNoteShape }).value.props.paperHeight).toBe(300)
	})

	it('keeps its pin the same size however large it is drawn, and shrinks it only with a smaller note', () => {
		// On the board, a pin is its paper-unit width times the note's scale.
		const onBoard = (scale: number) => pinPlacement(300, scale).width * scale
		expect(onBoard(2.2)).toBeCloseTo(onBoard(1))
		expect(onBoard(5)).toBeCloseTo(onBoard(1))
		expect(onBoard(0.5)).toBeCloseTo(onBoard(1) / 2)
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

describe('a pinned note’s pin', () => {
	it('is the design’s crimson by default, and takes a palette colour as a style', () => {
		const id = createShapeId('pinned')
		editor.createShapes([{ id, type: 'pinned-note', x: 0, y: 0 }])
		expect(editor.getShape<TLPinnedNoteShape>(id)!.props.pinColor).toBe('crimson')

		editor.select(id)
		editor.setStyleForSelectedShapes(PinColorStyle, 'blue')
		expect(editor.getShape<TLPinnedNoteShape>(id)!.props.pinColor).toBe('blue')
	})

	it('stays crimson on a pinned note saved before pins had a colour', () => {
		const schema = editor.store.schema.serialize() as { sequences: Record<string, number> }
		const before = { ...schema, sequences: { ...schema.sequences, 'com.tldraw.shape.pinned-note': 0 } }
		const id = createShapeId('old')
		editor.createShapes([{ id, type: 'pinned-note', x: 0, y: 0 }])
		const { pinColor: _gone, ...oldProps } = editor.getShape<TLPinnedNoteShape>(id)!.props
		const old = { ...editor.getShape(id)!, props: oldProps }
		const result = editor.store.schema.migratePersistedRecord(old as never, before as never)
		expect(result).toMatchObject({ type: 'success', value: { props: { pinColor: 'crimson' } } })
	})

	it('exports in its colour, its shine a shade darker', async () => {
		const id = createShapeId('pinned')
		editor.createShapes([{ id, type: 'pinned-note', x: 0, y: 0, props: { pinColor: 'green' } }])
		const svg = (await editor.getSvg([id]))!.outerHTML
		const { head, shine } = getPinPaint('green', editor.getCurrentTheme().colors[editor.getColorMode()])
		expect(svg).toContain(`fill="${head}"`)
		expect(svg).toContain(`fill="${shine}"`)
		expect(svg).not.toContain('fill="#991B1B"')
	})
})
