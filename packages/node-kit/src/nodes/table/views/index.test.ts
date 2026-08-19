import { describe, expect, it } from 'vitest'
import type { PropertyDef } from '../../../properties/types'
import {
	DEFAULT_COLUMN_WIDTH,
	LABEL_COLUMN,
	LAYOUT_MODES,
	defaultTableProps,
	tableLayoutValidator,
	type TableColumn,
	type TableNodeProps,
} from '../spec'
import { getViewDefinition, getViewDefinitions } from './index'
import { headlineColumn } from './value'

const column = (key: string, summary: TableColumn['summary']): TableColumn => ({
	key,
	summary,
	width: DEFAULT_COLUMN_WIDTH,
})

describe('the view registry', () => {
	/**
	 * The check that keeps the seam honest in both directions.
	 *
	 * A mode with no view renders nothing — and `node.config` would happily let an agent write one,
	 * since the validator's choices come from `LAYOUT_MODES`. A view with no mode is unreachable. Adding
	 * a view is meant to be one entry plus one enum member, and this fails when it is only one of them.
	 */
	it('has exactly one view per layout mode', () => {
		const modes = getViewDefinitions().map((view) => view.mode)
		expect([...modes].sort()).toEqual([...LAYOUT_MODES].sort())
		expect(new Set(modes).size).toBe(modes.length)
	})

	it('finds a view by mode', () => {
		for (const mode of LAYOUT_MODES) {
			expect(getViewDefinition(mode)?.mode).toBe(mode)
		}
	})

	it('names every view in a way "Show as …" can read', () => {
		for (const view of getViewDefinitions()) {
			expect(view.label).toMatch(/^[a-z]/)
			expect(view.label.trim()).toBe(view.label)
		}
	})
})

describe('the value view', () => {
	const props = (columns: TableColumn[], valueColumn?: string | null) => ({
		...defaultTableProps(),
		columns,
		layout: { ...defaultTableProps().layout, mode: 'value' as const, valueColumn },
	})

	const blocked = (columns: TableColumn[], valueColumn?: string | null) =>
		getViewDefinition('value')!.blockedReason!(props(columns, valueColumn), new Map())

	it('is blocked when no column has a summary', () => {
		expect(blocked([column(LABEL_COLUMN, null), column('price', null)])).toMatch(/summary/)
	})

	it('is ready as soon as one column has a summary', () => {
		expect(blocked([column(LABEL_COLUMN, 'count')])).toBeNull()
	})

	it('prefers a summary that produces a value over one that only counts', () => {
		const columns = [column(LABEL_COLUMN, 'count'), column('price', 'sum')]
		expect(headlineColumn(columns, undefined)?.key).toBe('price')
	})

	it('headlines a count when counting is all there is', () => {
		expect(headlineColumn([column(LABEL_COLUMN, 'count')], undefined)?.key).toBe(LABEL_COLUMN)
	})

	it('headlines the chosen column over the automatic one', () => {
		const columns = [column('price', 'sum'), column('weight', 'avg')]
		expect(headlineColumn(columns, 'weight')?.key).toBe('weight')
	})

	/**
	 * A `valueColumn` naming a column that has since been removed, or has lost its summary, must not
	 * blank the card: the number the user chose is gone either way, and falling back leaves them with a
	 * total rather than a dash they cannot explain.
	 */
	it('falls back when the chosen column is gone or unsummarised', () => {
		const columns = [column('price', 'sum'), column('weight', null)]
		expect(headlineColumn(columns, 'weight')?.key).toBe('price')
		expect(headlineColumn(columns, 'nonexistent')?.key).toBe('price')
	})

	it('has nothing to headline when no column is summarised', () => {
		expect(headlineColumn([column('price', null)], 'price')).toBeNull()
	})
})

/**
 * What a view fills in for itself when a card is switched to it.
 *
 * The point is that a switch lands on something that *works*: a calendar that opened saying "group by a
 * date" would be correct and useless when the board has exactly one date property.
 */
describe('prepare', () => {
	const DATE: PropertyDef = { id: 'due', name: 'Due', type: 'date' }
	const STATUS: PropertyDef = { id: 'stage', name: 'Stage', type: 'status', options: ['A'] }
	const SELECT: PropertyDef = { id: 'bed', name: 'Bed', type: 'select', options: ['A'] }

	const ask = (mode: 'kanban' | 'calendar', props: TableNodeProps, properties: PropertyDef[]) =>
		getViewDefinition(mode)!.prepare!({ props, properties })

	const withGroup = (groupBy: string | null): TableNodeProps => ({
		...defaultTableProps(),
		groupBy,
	})

	it('gives a calendar the board’s date property, bucketed by day', () => {
		expect(ask('calendar', withGroup(null), [STATUS, DATE])).toMatchObject({ groupBy: 'date:due' })
	})

	/** Grouping by the raw property would bucket by the stored string — one bucket per timestamp. */
	it('leaves a calendar that already groups by a day alone', () => {
		const prepared = ask('calendar', withGroup('date:due'), [DATE])
		expect(prepared?.groupBy).toBeUndefined()
	})

	it('states a calendar’s span rather than leaving it implied', () => {
		expect(ask('calendar', withGroup(null), [DATE])?.layout).toMatchObject({ span: 'week' })
	})

	it('has nothing to offer a calendar on a board with no dates', () => {
		expect(ask('calendar', withGroup(null), [STATUS])).toBeNull()
	})

	/** A status first: its stages order the lanes to-do → doing → done rather than alphabetically. */
	it('prefers a status over a select for a kanban', () => {
		expect(ask('kanban', withGroup(null), [SELECT, STATUS])).toEqual({ groupBy: 'stage' })
		expect(ask('kanban', withGroup(null), [SELECT])).toEqual({ groupBy: 'bed' })
	})

	it('leaves a kanban that already has lanes alone', () => {
		expect(ask('kanban', withGroup('stage'), [STATUS])).toBeNull()
	})

	it('has nothing to offer a kanban with nothing to make lanes from', () => {
		expect(ask('kanban', withGroup(null), [DATE])).toBeNull()
	})
})

describe('the layout validator', () => {
	/**
	 * Every table persisted before views existed has a `layout` of exactly `{ mode, maxRows }`. tldraw
	 * validates props on load, so if this ever stops passing, those boards stop opening.
	 */
	it('accepts a layout with no view settings on it', () => {
		expect(tableLayoutValidator.validate({ mode: 'table', maxRows: 12 })).toEqual({
			mode: 'table',
			maxRows: 12,
		})
	})

	/**
	 * Every one of these reaches an agent through `node.configure`, which validates against exactly this
	 * — so a field the validator rejects is a field an agent cannot set, however well the UI handles it.
	 */
	it('accepts every view setting an agent could send', () => {
		expect(
			tableLayoutValidator.validate({
				mode: 'calendar',
				maxRows: 12,
				span: 'week',
				anchor: '2026-08-13',
				lanes: ['To-do', 'Done'],
			})
		).toMatchObject({ span: 'week', anchor: '2026-08-13', lanes: ['To-do', 'Done'] })
	})

	it('accepts a chosen value column, and its explicit absence', () => {
		expect(
			tableLayoutValidator.validate({ mode: 'value', maxRows: 12, valueColumn: 'price' })
		).toMatchObject({ valueColumn: 'price' })
		expect(
			tableLayoutValidator.validate({ mode: 'value', maxRows: 12, valueColumn: null })
		).toMatchObject({ valueColumn: null })
	})

	/**
	 * The reason a mode is only added alongside its view: until then, this is what refuses it — including
	 * to an agent, which reaches `layout` through `node.configure` and is validated by exactly this.
	 * `gallery` stands in for the whole deferred list at the end of `docs/views-plan.md`.
	 */
	it('refuses a mode no view can draw', () => {
		expect(() => tableLayoutValidator.validate({ mode: 'gallery', maxRows: 12 })).toThrow()
	})
})
