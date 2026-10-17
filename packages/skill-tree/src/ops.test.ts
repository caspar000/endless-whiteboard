import type { Editor, TLShape, TLShapeId } from '@lifeboard/canvas'
import { describe, expect, it } from 'vitest'
import { childrenOf, evidenceNoteFor, isHiddenByCollapse, isItem, isTrack, ITEM_TYPE, NOTE_TYPE, type ItemShape } from './board'
import { itemNodeDefinition } from './item/definition'
import { hasEvidence, parseOrder } from './model'
import { addChildItem, createItem, createTrack, moveInTrack, setCollapsed, setItemDone } from './ops'
import { isDone, readText } from './properties'
import { ADLER_SAMPLE, insertAdlerSample } from './sample'
import { templateFor } from './templates'
import { trackNodeDefinition } from './track/definition'

/**
 * Just enough editor for the syllabus ops: shapes in a map with tldraw's one-level-deep merges of
 * `props` and `meta`, the document meta the property registry lives in, and counted history marks
 * (one user action must be one ⌘Z).
 */
function fakeEditor() {
	const shapes = new Map<string, TLShape>()
	let documentMeta: Record<string, unknown> = {}
	let marks = 0
	let selected: string[] = []
	const defaults: Record<string, () => object> = {
		[ITEM_TYPE]: () => itemNodeDefinition.defaultProps(),
		'node.track': () => trackNodeDefinition.defaultProps(),
		[NOTE_TYPE]: () => ({ md: '', autoHeight: true }),
	}
	const editor = {
		getDocumentSettings: () => ({ meta: documentMeta }),
		updateDocumentSettings: (partial: { meta?: Record<string, unknown> }) => {
			if (partial.meta) documentMeta = partial.meta
		},
		run: (fn: () => void) => fn(),
		markHistoryStoppingPoint: (name?: string) => {
			marks++
			return name ?? 'mark'
		},
		getShape: (id: string) => shapes.get(id),
		getCurrentPageShapes: () => [...shapes.values()],
		getCurrentPageId: () => 'page:page',
		getShapePageBounds: (id: string) => {
			const s = shapes.get(id)
			if (!s) return undefined
			return { x: s.x, y: s.y, w: 260, h: 56, maxX: s.x + 260, maxY: s.y + 56 }
		},
		createShape: (partial: { id: string; type: string; x?: number; y?: number; props?: object; meta?: object }) => {
			shapes.set(partial.id, {
				id: partial.id,
				type: partial.type,
				x: partial.x ?? 0,
				y: partial.y ?? 0,
				props: { ...(defaults[partial.type]?.() ?? {}), ...partial.props },
				meta: { ...partial.meta },
			} as unknown as TLShape)
		},
		updateShape: (partial: { id: string; x?: number; y?: number; props?: object; meta?: object }) => {
			const prev = shapes.get(partial.id)
			if (!prev) return
			shapes.set(partial.id, {
				...prev,
				...(partial.x !== undefined ? { x: partial.x } : {}),
				...(partial.y !== undefined ? { y: partial.y } : {}),
				props: { ...prev.props, ...partial.props },
				meta: { ...prev.meta, ...partial.meta },
			} as TLShape)
		},
		createBindings: () => {},
		getSelectedShapeIds: () => selected,
		setSelectedShapes: (ids: string[]) => {
			selected = ids
		},
	} as unknown as Editor
	return {
		editor,
		shape: (id: TLShapeId) => shapes.get(id)!,
		get marks() {
			return marks
		},
		resetMarks: () => {
			marks = 0
		},
		arrows: () => [...shapes.values()].filter((s) => s.type === 'arrow'),
	}
}

describe('ticking an item', () => {
	it('records Done and the day, files a note from the medium template, related to the item', () => {
		const f = fakeEditor()
		const id = createItem(f.editor, { title: 'Poetics', kind: 'Study', medium: 'book' }, { x: 0, y: 0 })
		setItemDone(f.editor, id, true)

		const item = f.shape(id) as ItemShape
		expect(isDone(item)).toBe(true)
		expect(readText(item, 'doneAt')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
		const note = evidenceNoteFor(f.editor, item.props.itemId)!
		expect((note.props as { md: string }).md).toBe(`# Poetics\n\n${templateFor('book').md}`)
		expect(readText(note, 'method')).toBe('analytical')
		// The template alone is not evidence: the tick is hollow until something is written.
		expect(hasEvidence((note.props as { md: string }).md, templateFor('book').md)).toBe(false)
		expect(f.arrows()).toHaveLength(1)
	})

	it('is one undo entry', () => {
		const f = fakeEditor()
		const id = createItem(f.editor, { title: 'Poetics' }, { x: 0, y: 0 })
		f.resetMarks()
		setItemDone(f.editor, id, true)
		expect(f.marks).toBe(1)
	})

	it('reopening clears the date and keeps the note', () => {
		const f = fakeEditor()
		const id = createItem(f.editor, { title: 'Poetics', medium: 'book' }, { x: 0, y: 0 })
		setItemDone(f.editor, id, true)
		setItemDone(f.editor, id, false)
		const item = f.shape(id) as ItemShape
		expect(isDone(item)).toBe(false)
		expect(readText(item, 'doneAt')).toBe('')
		expect(evidenceNoteFor(f.editor, item.props.itemId)).toBeDefined()

		// And ticking again reuses it rather than filing a second one.
		setItemDone(f.editor, id, true)
		const notes = f.editor.getCurrentPageShapes().filter((s) => (s.type as string) === NOTE_TYPE)
		expect(notes).toHaveLength(1)
	})
})

describe('parents', () => {
	function plato() {
		const f = fakeEditor()
		const parent = createItem(f.editor, { title: 'Plato' }, { x: 0, y: 0 })
		const republic = addChildItem(f.editor, parent, { title: 'Republic', core: true })!
		const meno = addChildItem(f.editor, parent, { title: 'Meno' })!
		return { f, parent, republic, meno }
	}

	it('are done when their core children are, and undone again when one reopens', () => {
		const { f, parent, republic, meno } = plato()
		setItemDone(f.editor, meno, true)
		expect(isDone(f.shape(parent))).toBe(false)
		setItemDone(f.editor, republic, true)
		expect(isDone(f.shape(parent))).toBe(true)
		setItemDone(f.editor, republic, false)
		expect(isDone(f.shape(parent))).toBe(false)
	})

	it('cannot be ticked directly', () => {
		const { f, parent } = plato()
		setItemDone(f.editor, parent, true)
		expect(isDone(f.shape(parent))).toBe(false)
	})

	it('collapsing hides the children, and only them', () => {
		const { f, parent, republic } = plato()
		setCollapsed(f.editor, parent, true)
		expect(isHiddenByCollapse(f.editor, f.shape(republic) as ItemShape)).toBe(true)
		expect(isHiddenByCollapse(f.editor, f.shape(parent) as ItemShape)).toBe(false)
		setCollapsed(f.editor, parent, false)
		expect(isHiddenByCollapse(f.editor, f.shape(republic) as ItemShape)).toBe(false)
	})

	it('children sit in a column to the right, in the order they were added', () => {
		const { f, parent } = plato()
		const kids = childrenOf(f.editor, parent)
		expect(kids.map((k) => k.props.title)).toEqual(['Republic', 'Meno'])
		expect(kids[0]!.x).toBeGreaterThan(f.shape(parent).x)
		expect(kids[1]!.y).toBeGreaterThan(kids[0]!.y)
	})
})

describe('tracks', () => {
	it('move an item a place without losing any', () => {
		const f = fakeEditor()
		const id = createTrack(f.editor, { name: 'T', itemIds: ['a', 'b', 'c'] }, { x: 0, y: 0 })
		const track = f.shape(id)
		if (!isTrack(track)) throw new Error('not a track')
		moveInTrack(f.editor, track, 'c', -1)
		expect(parseOrder((f.shape(id) as typeof track).props.order)).toEqual(['a', 'c', 'b'])
	})
})

describe('the Adler sample', () => {
	it('is one undo entry, with every entry in the track and works collapsed under their entry', () => {
		const f = fakeEditor()
		const trackId = insertAdlerSample(f.editor, { x: 0, y: 0 })
		expect(f.marks).toBe(1)

		const track = f.shape(trackId)
		if (!isTrack(track)) throw new Error('not a track')
		const order = parseOrder(track.props.order)
		expect(order).toHaveLength(ADLER_SAMPLE.length)

		const items = f.editor.getCurrentPageShapes().filter(isItem)
		const plato = items.find((i) => i.props.title === 'Plato, Dialogues')!
		expect(plato.props.collapsed).toBe(true)
		expect(childrenOf(f.editor, plato.id)).toHaveLength(10)
		expect(childrenOf(f.editor, plato.id).filter((c) => c.props.core)).toHaveLength(3)
	})
})
