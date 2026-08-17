import type { Editor } from 'tldraw'
import { describe, expect, it } from 'vitest'
import {
	DEFAULT_RELATION_VIEW,
	RELATION_VIEWS,
	cycleRelationView,
	isRelationDrawn,
	nextRelationView,
	parseRelationView,
	readRelationView,
	setRelationView,
	type RelationView,
} from './relationView'

/** Just enough editor to hold a document record's meta. */
function fakeDocument(meta: Record<string, unknown> = {}) {
	const history: ('ignore' | 'record' | undefined)[] = []
	const editor = {
		run: (fn: () => void, options?: { history?: 'ignore' | 'record' }) => {
			history.push(options?.history)
			fn()
		},
		getDocumentSettings: () => ({ meta }),
		updateDocumentSettings: (partial: { meta?: Record<string, unknown> }) => {
			if (partial.meta) meta = partial.meta
		},
	} as unknown as Editor
	return { editor, history, meta: () => meta }
}

describe('isRelationDrawn', () => {
	/**
	 * All nine combinations, written out rather than looped: this is the rule the whole feature turns
	 * on, and a table you can read top to bottom is worth more here than one that is clever.
	 */
	const CASES: [RelationView, boolean, boolean][] = [
		// view, hidden, expected drawn
		['all', false, true],
		['all', true, true],
		['normal', false, true],
		['normal', true, false],
		['none', false, false],
		['none', true, false],
	]

	it.each(CASES)('view %s, hidden %s → drawn %s', (view, hidden, drawn) => {
		expect(isRelationDrawn(view, hidden, false)).toBe(drawn)
	})

	it('tracing beats everything, including a board set to none', () => {
		for (const view of RELATION_VIEWS) {
			for (const hidden of [true, false]) {
				// A lens that obeyed a "none" set five minutes ago would simply appear broken: pointing
				// at a node is a request to see what it is connected to.
				expect(isRelationDrawn(view, hidden, true)).toBe(true)
			}
		}
	})
})

describe('nextRelationView', () => {
	it('steps by how much is shown, and wraps', () => {
		expect(nextRelationView('none')).toBe('normal')
		expect(nextRelationView('normal')).toBe('all')
		expect(nextRelationView('all')).toBe('none')
	})

	it('returns to where it started after one full cycle', () => {
		let view: RelationView = DEFAULT_RELATION_VIEW
		for (let i = 0; i < RELATION_VIEWS.length; i++) view = nextRelationView(view)
		expect(view).toBe(DEFAULT_RELATION_VIEW)
	})
})

describe('reading and writing the board’s view', () => {
	it('defaults to normal on a board that has never been told', () => {
		expect(readRelationView(fakeDocument().editor)).toBe('normal')
	})

	it('round-trips through the document record', () => {
		const doc = fakeDocument()
		setRelationView(doc.editor, 'none')
		expect(readRelationView(doc.editor)).toBe('none')
	})

	it('keeps the rest of the document meta — the property registry lives there too', () => {
		const doc = fakeDocument({ 'lifeboard:properties': [{ id: 'p1' }] })
		setRelationView(doc.editor, 'all')
		expect(doc.meta()['lifeboard:properties']).toEqual([{ id: 'p1' }])
	})

	it('stays off the undo stack: changing what you look at is not an edit', () => {
		const doc = fakeDocument()
		setRelationView(doc.editor, 'all')
		// Otherwise: hide the wiring, spot a typo, press undo — and get the arrows back instead.
		expect(doc.history).toEqual(['ignore'])
	})

	it('falls back rather than trusting a stored value', () => {
		expect(parseRelationView('everything')).toBe('normal')
		expect(parseRelationView(undefined)).toBe('normal')
		expect(parseRelationView(3)).toBe('normal')
		// A board written by a future version that knows a fourth state opens on the default instead
		// of throwing — one bad value costs that value, never the board.
		expect(readRelationView(fakeDocument({ 'lifeboard:relationView': 'sideways' }).editor)).toBe(
			'normal'
		)
	})

	it('cycles from whatever is stored', () => {
		const doc = fakeDocument({ 'lifeboard:relationView': 'normal' })
		expect(cycleRelationView(doc.editor)).toBe('all')
		expect(readRelationView(doc.editor)).toBe('all')
	})
})
