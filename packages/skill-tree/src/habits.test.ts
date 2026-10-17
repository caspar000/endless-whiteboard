import { describe, expect, it } from 'vitest'
import { currentStreak, habitHistory, habitRuleValue, habitStart, parseFilter, periodKey, periodsBetween, type HabitSpec } from './habits'
import { evaluateTree } from './requirements'
import type { HabitEntry, IndexEntry } from './skillIndex'

function entry(itemId: string, doneAt: string, over: Partial<IndexEntry> = {}): IndexEntry {
	return {
		itemId,
		title: itemId,
		kind: 'Study',
		medium: 'film',
		tags: [],
		done: true,
		doneAt,
		evidence: true,
		method: 'film-sheet',
		core: false,
		parentItemId: '',
		hasChildren: false,
		position: 0,
		boardId: 'b',
		shapeId: `shape:${itemId}`,
		...over,
	}
}

const spec = (over: Partial<HabitSpec>): HabitSpec => ({
	habitId: 'h',
	period: 'week',
	target: 1,
	counts: '',
	startedAt: '2026-09-28',
	log: '{}',
	...over,
})

describe('periods', () => {
	it('keys weeks by their Monday, months by year and month', () => {
		expect(periodKey('2026-10-17', 'week')).toBe('2026-10-12')
		expect(periodKey('2026-10-12', 'week')).toBe('2026-10-12')
		expect(periodKey('2026-10-18', 'week')).toBe('2026-10-12')
		expect(periodKey('2026-10-17', 'month')).toBe('2026-10')
	})

	it('lists every period from the start to today', () => {
		expect(periodsBetween('2026-09-28', '2026-10-17', 'week')).toEqual(['2026-09-28', '2026-10-05', '2026-10-12'])
		expect(periodsBetween('2026-10-15', '2026-10-17', 'day')).toEqual(['2026-10-15', '2026-10-16', '2026-10-17'])
		expect(periodsBetween('2026-08-20', '2026-10-01', 'month')).toEqual(['2026-08', '2026-09', '2026-10'])
	})
})

describe('habitHistory', () => {
	it('counts written-up items matching its filter, in the period they were done', () => {
		const history = habitHistory(
			spec({ counts: 'medium: film' }),
			[entry('a', '2026-09-29'), entry('b', '2026-10-14'), entry('c', '2026-10-15', { medium: 'book' }), entry('d', '2026-10-16', { evidence: false })],
			'2026-10-17'
		)
		expect(history.map((p) => [p.key, p.count, p.met])).toEqual([
			['2026-09-28', 1, true],
			['2026-10-05', 0, false],
			['2026-10-12', 1, true],
		])
	})

	it('adds hand ticks, and reads a habit with no filter as ticked by hand only', () => {
		const history = habitHistory(spec({ log: '{"2026-10-05":2}' }), [entry('a', '2026-09-29')], '2026-10-17')
		expect(history.map((p) => p.count)).toEqual([0, 2, 0])
	})

	it('reads an unparseable filter as by hand, so a typo never invents progress', () => {
		expect(parseFilter('kind: [oops')).toBeNull()
		expect(parseFilter('nothing: here')).toBeNull()
	})
})

describe('rules', () => {
	const history = [
		{ key: 'a', count: 1, met: true },
		{ key: 'b', count: 2, met: true },
		{ key: 'c', count: 0, met: false },
		{ key: 'd', count: 3, met: true },
	]

	it('reads total, streak, periods on target and best week', () => {
		expect(habitRuleValue(history, 'total', 'week')).toBe(6)
		expect(habitRuleValue(history, 'streak', 'week')).toBe(2)
		expect(habitRuleValue(history, 'periods', 'week')).toBe(3)
		expect(habitRuleValue(history, 'best_week', 'week')).toBe(3)
	})

	it('counts the current streak back from now, not counting an unfinished current period against it', () => {
		expect(currentStreak([...history.slice(0, 2), { key: 'now', count: 0, met: false }])).toBe(2)
		expect(currentStreak(history)).toBe(1)
	})
})

describe('starting', () => {
	it('waits for its item, then starts the day the item was done', () => {
		const habit = { startedAt: '2026-09-01', startedBy: 'unit' }
		expect(habitStart(habit, {})).toBeNull()
		expect(habitStart(habit, { unit: entry('unit', '2026-10-02') })).toBe('2026-10-02')
		expect(habitStart({ startedAt: '2026-09-01', startedBy: '' }, {})).toBe('2026-09-01')
	})
})

describe('habit conditions on skill nodes', () => {
	it('unlock a node once the habit has been kept long enough', () => {
		const habit: HabitEntry = {
			habitId: 'films',
			name: 'Film week',
			goal: '',
			period: 'week',
			target: 1,
			counts: 'medium: film',
			startedBy: '',
			startedAt: '2026-09-28',
			log: '{}',
			state: 'active',
			boardId: 'b',
			shapeId: 'shape:h',
		}
		const nodes = [{ nodeId: 'n', name: 'N', requires: '- habit: { id: films, rule: periods, min: 2 }' }]
		const one = { a: entry('a', '2026-09-29') }
		const two = { ...one, b: entry('b', '2026-10-14') }
		expect(evaluateTree(nodes, one, { films: habit }, '2026-10-17').get('n')!.state).toBe('available')
		expect(evaluateTree(nodes, two, { films: habit }, '2026-10-17').get('n')!.state).toBe('unlocked')
	})
})
