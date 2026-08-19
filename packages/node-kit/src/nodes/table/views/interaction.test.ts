import { beforeEach, describe, expect, it } from 'vitest'
import type { TLShape } from 'tldraw'
import { fakeEditor, makeShape } from '../../../properties/fakeEditor'
import type { PropertyDef } from '../../../properties/types'
import { readShapeProperties } from '../../../properties/values'
import type { DropTarget } from '../../../registry'
import { TABLE_NODE_TYPE } from '../definition'
import { EMPTY_GROUP_KEY, EMPTY_TABLE } from '../query'
import {
	DATE_GROUP_PREFIX,
	LABEL_COLUMN,
	defaultTableProps,
	type TableNodeProps,
} from '../spec'
import { dayBoxes, rowTop } from './calendarLayout'
import { getDropHint, setDropHint } from './dropHint'
import { getViewDefinition } from './index'
import { acceptsViewDrop, applyViewDrop } from './interaction'
import { contentTop, laneBoxes } from './kanbanLayout'
import { readViewHome } from './ownership'

/**
 * What a drop *writes*. The geometry — which lane a point is in — is `laneAt`'s, in
 * `kanbanLayout.test.ts`; that a drop happens at all is the e2e's, since it is tldraw that decides
 * which shape a released drag was over.
 */

function view(over: Partial<TableNodeProps> = {}): TLShape {
	const props = { ...defaultTableProps(), groupBy: 'status', ...over }
	props.layout = { ...props.layout, mode: 'kanban', ...(over.layout ?? {}) }
	return {
		id: 'shape:view',
		type: TABLE_NODE_TYPE,
		x: 0,
		y: 0,
		meta: {},
		props: { ...props, w: 600, h: 300 },
	} as unknown as TLShape
}

/** A kanban lane as its own `dropAt` reports it — see the `dropAt` block below, which pins that. */
function lane(key: string): DropTarget {
	return { key, values: { status: key === EMPTY_GROUP_KEY ? null : key } }
}

/** A board with a Status property defined, plus whatever shapes the test needs. */
function board(shapes: Record<string, TLShape>) {
	const fake = fakeEditor({ shapes })
	fake.editor.updateDocumentSettings({
		meta: {
			'lifeboard:properties': [
				{ id: 'status', name: 'Status', type: 'status', options: ['To-do', 'Done'] },
			],
		},
	})
	return fake
}

describe('acceptsViewDrop', () => {
	it('accepts a kanban with lanes', () => {
		expect(acceptsViewDrop(view())).toBe(true)
	})

	/**
	 * A table has nowhere to put a dropped card — and this answer is also tldraw's
	 * `canReceiveNewChildrenOfType`, so `false` keeps a plain table out of the paste-reparenting
	 * candidates as well. See `docs/tldraw-api-notes.md`.
	 */
	it('refuses a readout, and a kanban with nothing to make lanes from', () => {
		expect(acceptsViewDrop(view({ layout: { mode: 'table', maxRows: 12 } }))).toBe(false)
		expect(acceptsViewDrop(view({ groupBy: null }))).toBe(false)
	})
})

describe('applyViewDrop', () => {
	it("writes the lane's value to the dropped shape", () => {
		const card = makeShape('shape:a')
		const fake = board({ 'shape:a': card })
		applyViewDrop(fake.editor, view(), [card], lane('Done'))
		expect(readShapeProperties(fake.shape('shape:a')).status).toBe('Done')
	})

	/**
	 * The gesture that matters most: a plain sticky with no Status *becomes* a card by being dragged into
	 * a lane. Membership is "carries the lane property", so this write is the whole of what makes a
	 * non-member join.
	 */
	it('attaches the property to a shape that never carried it', () => {
		const card = makeShape('shape:a')
		expect(readShapeProperties(card).status).toBeUndefined()
		const fake = board({ 'shape:a': card })
		applyViewDrop(fake.editor, view(), [card], lane('To-do'))
		expect(readShapeProperties(fake.shape('shape:a')).status).toBe('To-do')
	})

	/** That lane stands for an absence. Storing its label would put the card in a state no picker offers. */
	it('clears the value when dropped on the empty lane', () => {
		const card = makeShape('shape:a', { 'lifeboard:props': { status: 'Done' } })
		const fake = board({ 'shape:a': card })
		applyViewDrop(fake.editor, view(), [card], lane(EMPTY_GROUP_KEY))
		const values = readShapeProperties(fake.shape('shape:a'))
		expect(values.status).toBeNull()
		// Attached but empty, not removed: that is what puts it in the empty lane rather than out of the
		// view altogether.
		expect('status' in values).toBe(true)
	})

	it('records a home at the drop point, marked as handed over', () => {
		const card = { ...makeShape('shape:a'), x: 400, y: 250 } as TLShape
		const fake = board({ 'shape:a': card })
		applyViewDrop(fake.editor, view(), [card], lane('To-do'))
		expect(readViewHome(fake.shape('shape:a'))).toEqual({
			viewId: 'shape:view',
			x: 400,
			y: 250,
			adopted: 'drop',
		})
	})

	/**
	 * A card dragged from one lane to another keeps the home it arrived with, so clearing its status later
	 * still returns it to the part of the board it came from rather than to a lane it passed through.
	 */
	it('leaves an existing home alone', () => {
		const home = { viewId: 'shape:view', x: 900, y: 900, adopted: 'query' }
		const card = makeShape('shape:a', {
			'lifeboard:props': { status: 'To-do' },
			'lifeboard:viewHome': home,
		})
		const fake = board({ 'shape:a': card })
		applyViewDrop(fake.editor, view(), [card], lane('Done'))
		expect(readViewHome(fake.shape('shape:a'))).toEqual(home)
		expect(readShapeProperties(fake.shape('shape:a')).status).toBe('Done')
	})

	it('will not take a card another view owns', () => {
		const card = makeShape('shape:a', {
			'lifeboard:viewHome': { viewId: 'shape:other', x: 0, y: 0, adopted: 'query' },
		})
		const fake = board({ 'shape:a': card })
		applyViewDrop(fake.editor, view(), [card], lane('Done'))
		expect(readShapeProperties(fake.shape('shape:a')).status).toBeUndefined()
	})

	it('refuses a container, a relation and another view', () => {
		const frame = { ...makeShape('shape:frame'), type: 'frame' } as TLShape
		const arrow = { ...makeShape('shape:arrow'), type: 'arrow' } as TLShape
		const other = { ...makeShape('shape:other'), type: TABLE_NODE_TYPE } as TLShape
		const fake = board({ 'shape:frame': frame, 'shape:arrow': arrow, 'shape:other': other })
		applyViewDrop(fake.editor, view(), [frame, arrow, other], lane('Done'))
		for (const id of ['shape:frame', 'shape:arrow', 'shape:other']) {
			expect(readShapeProperties(fake.shape(id)).status).toBeUndefined()
		}
	})

	/** One user action is one undo entry, however many cards were in hand. */
	it('files a whole selection in one history entry', () => {
		const a = makeShape('shape:a')
		const b = makeShape('shape:b')
		const fake = board({ 'shape:a': a, 'shape:b': b })
		applyViewDrop(fake.editor, view(), [a, b], lane('Done'))
		expect(readShapeProperties(fake.shape('shape:a')).status).toBe('Done')
		expect(readShapeProperties(fake.shape('shape:b')).status).toBe('Done')
		// Nested writes join the outer batch, so what decides how many ⌘Zs it takes is the one mark.
		expect(fake.marks).toBe(1)
	})

	/**
	 * A target that says nothing writes nothing — no empty history entry, which is a ⌘Z that appears to do
	 * nothing at all. Whether a *view* can produce a target is `dropAt`'s business, tested below.
	 */
	it('writes nothing for a target with no values on it', () => {
		const fake = board({ 'shape:a': makeShape('shape:a') })
		applyViewDrop(fake.editor, view(), [fake.shape('shape:a')], { key: 'Done', values: {} })
		expect(fake.marks).toBe(0)
	})

	it('writes nothing when no shape can receive the drop', () => {
		const frame = { ...makeShape('shape:frame'), type: 'frame' } as TLShape
		const fake = board({ 'shape:frame': frame })
		applyViewDrop(fake.editor, view(), [frame], lane('Done'))
		expect(fake.marks).toBe(0)
	})
})

/**
 * What a *point* on a view means — each view's own answer, and the reason a calendar can accept drops
 * without arranging anything. Pure data in, data out: no editor, because the factory has already
 * converted the cursor into the shape's own space.
 */
describe('dropAt', () => {
	const STATUS: PropertyDef = {
		id: 'status',
		name: 'Status',
		type: 'status',
		options: ['To-do', 'Done'],
	}
	const properties = new Map([[STATUS.id, STATUS]])

	function ask(mode: 'kanban' | 'calendar', groupBy: string, local: { x: number; y: number }) {
		const props = { ...defaultTableProps(), groupBy }
		// Thursday 13 August 2026, so a calendar shows Mon 10 – Sun 16: a week, which is what this view
		// shows unless a month is asked for.
		props.layout = { ...props.layout, mode, anchor: '2026-08-13' }
		return getViewDefinition(mode)!.dropAt!({
			props,
			properties,
			result: EMPTY_TABLE,
			local,
			width: 600,
			height: 400,
		})
	}

	it('turns a point in a kanban lane into a status', () => {
		const boxes = laneBoxes(['To-do', 'Done'], 600)
		const target = ask('kanban', 'status', { x: boxes[1]!.x + 10, y: contentTop() })
		expect(target).toEqual({ key: 'Done', values: { status: 'Done' } })
	})

	it('turns a point in a calendar day into a date', () => {
		// A week, which is what a calendar shows unless asked otherwise: Monday 10th to Sunday 16th.
		const boxes = dayBoxes('2026-08-13', 'week', 600)
		const thursday = boxes.find((box) => box.day === '2026-08-13')!
		const target = ask('calendar', `${DATE_GROUP_PREFIX}due`, {
			x: thursday.x + 4,
			y: rowTop(0, 1, 400) + 4,
		})
		expect(target).toEqual({ key: '2026-08-13', values: { due: '2026-08-13' } })
	})

	/** The card's own name is not a column or a day, so dropping on it is a miss rather than a guess. */
	it('is nothing on either view’s title strip', () => {
		expect(ask('kanban', 'status', { x: 300, y: 2 })).toBeNull()
		expect(ask('calendar', `${DATE_GROUP_PREFIX}due`, { x: 300, y: 2 })).toBeNull()
	})

	it('is nothing at all when the view has nothing to group by', () => {
		expect(ask('kanban', LABEL_COLUMN, { x: 300, y: 200 })).toBeNull()
		expect(ask('calendar', 'due', { x: 300, y: 200 })).toBeNull()
	})
})

describe('the drop hint', () => {
	beforeEach(() => setDropHint('shape:view', null))

	it('remembers which lane of which view is lit', () => {
		setDropHint('shape:view', 'Done')
		expect(getDropHint()).toEqual({ viewId: 'shape:view', lane: 'Done' })
	})

	/**
	 * Dragging from one kanban straight into another delivers the second view's `onDragShapesOver` before
	 * the first view's `onDragShapesOut`, so a clear that ignored whose hint it was would blank the lane
	 * that had just lit up.
	 */
	it('is only cleared by the view that lit it', () => {
		setDropHint('shape:second', 'To-do')
		setDropHint('shape:view', null)
		expect(getDropHint()).toEqual({ viewId: 'shape:second', lane: 'To-do' })
		setDropHint('shape:second', null)
		expect(getDropHint()).toBeNull()
	})
})
