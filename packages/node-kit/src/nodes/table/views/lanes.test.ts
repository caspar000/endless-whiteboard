import { describe, expect, it } from 'vitest'
import type { PropertyDef } from '../../../properties/types'
import { EMPTY_GROUP_KEY, type TableGroup } from '../query'
import { CURRENCY_GROUP_PREFIX, LABEL_COLUMN, defaultTableProps } from '../spec'
import { laneKeys, laneProperty } from './lanes'

/** A group as the query produces it; only the key and the row count matter to lane ordering. */
const group = (key: string, rows = 1): TableGroup => ({
	key,
	rows: Array.from({ length: rows }, (_, i) => ({
		shapeId: `shape:${key}-${i}`,
		label: key,
		cells: {},
		units: {},
	})),
	summaries: {},
	money: {},
})

const status = (options: string[], stages?: Record<string, 'todo' | 'active' | 'done'>): PropertyDef => ({
	id: 'status',
	name: 'Status',
	type: 'status',
	options,
	...(stages ? { stages } : {}),
})

describe('laneProperty', () => {
	const props = (groupBy: string | null) => ({ ...defaultTableProps(), groupBy })

	it('is the group property', () => {
		expect(laneProperty(props('status'))).toBe('status')
	})

	it('refuses no grouping at all', () => {
		expect(laneProperty(props(null))).toBeNull()
	})

	/**
	 * The one that matters most. A kanban grouped by the label column would query with no property
	 * column, and `queryTable` keeps every match when there are none — so the view would try to file
	 * every drawing on the page into a lane. See the plan's gotcha 1.
	 */
	it('refuses the label column', () => {
		expect(laneProperty(props(LABEL_COLUMN))).toBeNull()
	})

	it('refuses a currency grouping', () => {
		expect(laneProperty(props(`${CURRENCY_GROUP_PREFIX}price`))).toBeNull()
	})
})

describe('laneKeys', () => {
	it('follows the stages of a status property, not the size of its buckets', () => {
		// The query hands these over biggest-first, which for a status property is the wrong order to read.
		const groups = [group('Done', 5), group('To-do', 3), group('Doing', 1)]
		const def = status(['To-do', 'Doing', 'Done'], {
			'To-do': 'todo',
			Doing: 'active',
			Done: 'done',
		})
		expect(laneKeys(def, groups)).toEqual(['To-do', 'Doing', 'Done'])
	})

	it('orders within a stage as the options are declared', () => {
		const def = status(['Blocked', 'To-do', 'Doing'], {
			Blocked: 'todo',
			'To-do': 'todo',
			Doing: 'active',
		})
		expect(laneKeys(def, [group('Doing')])).toEqual(['Blocked', 'To-do', 'Doing'])
	})

	/** Unlisted stages count as `todo`, which is `stageForOption`'s own rule. */
	it('treats options with no stage as to-do', () => {
		const def = status(['Shipped', 'Fresh'], { Shipped: 'done' })
		expect(laneKeys(def, [])).toEqual(['Fresh', 'Shipped'])
	})

	it('draws lanes for options nothing is in yet', () => {
		const def = status(['To-do', 'Doing', 'Done'])
		expect(laneKeys(def, [group('To-do')])).toEqual(['To-do', 'Doing', 'Done'])
	})

	it('uses the declared order for a plain select', () => {
		const def: PropertyDef = { id: 'stage', name: 'Stage', type: 'select', options: ['B', 'A'] }
		expect(laneKeys(def, [group('A', 9), group('B')])).toEqual(['B', 'A'])
	})

	it("falls back to the query's own order with no options to go on", () => {
		const def: PropertyDef = { id: 'who', name: 'Who', type: 'text' }
		expect(laneKeys(def, [group('Ann', 4), group('Bo')])).toEqual(['Ann', 'Bo'])
	})

	it('works with no property definition at all', () => {
		expect(laneKeys(null, [group('x'), group('y')])).toEqual(['x', 'y'])
	})

	/**
	 * `options` is "a convenience list, never a constraint" (`properties/types.ts`), so a value somebody
	 * typed that is not in it still has a lane. A lane list that could hide a card would lose work.
	 */
	it('appends values the options list has never heard of', () => {
		const def = status(['To-do', 'Done'])
		expect(laneKeys(def, [group('Waiting')])).toEqual(['To-do', 'Done', 'Waiting'])
	})

	it('honours a stored lane order and still appends what it missed', () => {
		const def = status(['To-do', 'Doing', 'Done'])
		expect(laneKeys(def, [group('Waiting')], ['Done', 'To-do'])).toEqual([
			'Done',
			'To-do',
			'Doing',
			'Waiting',
		])
	})

	it('puts the empty lane last, and only when something is in it', () => {
		const def = status(['To-do', 'Done'])
		expect(laneKeys(def, [group(EMPTY_GROUP_KEY, 2), group('Done')])).toEqual([
			'To-do',
			'Done',
			EMPTY_GROUP_KEY,
		])
		expect(laneKeys(def, [group('Done')])).toEqual(['To-do', 'Done'])
	})

	it('never repeats a lane', () => {
		const def = status(['To-do', 'To-do'])
		expect(laneKeys(def, [group('To-do'), group('To-do')], ['To-do'])).toEqual(['To-do'])
	})
})
