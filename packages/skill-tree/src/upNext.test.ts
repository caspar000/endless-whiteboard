import { describe, expect, it } from 'vitest'
import type { HabitEntry, IndexEntry, TrackEntry } from './skillIndex'
import { goalsOf, upNext } from './upNext'

function item(itemId: string, over: Partial<IndexEntry> = {}): IndexEntry {
	return {
		itemId,
		title: itemId,
		kind: 'Study',
		medium: 'book',
		tags: [],
		done: false,
		doneAt: '',
		evidence: false,
		method: '',
		core: false,
		parentItemId: '',
		hasChildren: false,
		position: 0,
		boardId: 'b',
		shapeId: `shape:${itemId}`,
		...over,
	}
}

const track = (trackId: string, order: string[], over: Partial<TrackEntry> = {}): TrackEntry => ({
	trackId,
	name: trackId,
	goal: 'g',
	state: 'active',
	order,
	boardId: 'b',
	shapeId: `shape:${trackId}`,
	...over,
})

const index = (...entries: IndexEntry[]) => Object.fromEntries(entries.map((e) => [e.itemId, e]))

describe('upNext', () => {
	it('gives each active track its first undone item, skipping done ones', () => {
		const result = upNext([track('t', ['a', 'b', 'c'])], index(item('a', { done: true }), item('b'), item('c')), [], '2026-10-17')
		expect(result.steps.map((s) => s.step.itemId)).toEqual(['b'])
	})

	it("walks into a unit to its next undone step, in the steps' order", () => {
		const entries = index(
			item('unit', { hasChildren: true }),
			item('watch', { parentItemId: 'unit', position: 1 }),
			item('read', { parentItemId: 'unit', position: 0, done: true }),
			item('make', { parentItemId: 'unit', position: 2 })
		)
		const [step] = upNext([track('t', ['unit'])], entries, [], '2026-10-17').steps
		expect(step!.step.itemId).toBe('watch')
		expect(step!.parent!.itemId).toBe('unit')
	})

	it('leaves out paused tracks and other goals', () => {
		const entries = index(item('a'), item('b'))
		const tracks = [track('t1', ['a'], { state: 'paused' }), track('t2', ['b'], { goal: 'other' })]
		expect(upNext(tracks, entries, [], '2026-10-17', 'g').steps).toEqual([])
		expect(upNext(tracks, entries, [], '2026-10-17').steps.map((s) => s.track.trackId)).toEqual(['t2'])
	})

	it('lists habits not yet met this period, and drops them once met', () => {
		const habit: HabitEntry = {
			habitId: 'h',
			name: 'Read',
			goal: 'g',
			period: 'day',
			target: 1,
			counts: '',
			startedBy: '',
			startedAt: '2026-10-01',
			log: '{}',
			state: 'active',
			boardId: 'b',
			shapeId: 'shape:h',
		}
		expect(upNext([], {}, [habit], '2026-10-17').habits.map((h) => h.count)).toEqual([0])
		expect(upNext([], {}, [{ ...habit, log: '{"2026-10-17":1}' }], '2026-10-17').habits).toEqual([])
	})

	it('counts completed leaves per day for the heatmap', () => {
		const entries = index(
			item('a', { done: true, doneAt: '2026-10-16' }),
			item('b', { done: true, doneAt: '2026-10-16' }),
			item('parent', { done: true, doneAt: '2026-10-16', hasChildren: true })
		)
		expect(upNext([], entries, [], '2026-10-17').days.get('2026-10-16')).toBe(2)
	})

	it('collects goals for the filter', () => {
		expect(goalsOf([track('t', [], { goal: 'b' })], [])).toEqual(['b'])
	})
})
