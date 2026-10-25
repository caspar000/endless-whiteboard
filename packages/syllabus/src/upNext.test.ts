import { describe, expect, it } from 'vitest'
import type { IndexEntry, TrackEntry } from './skillIndex'
import { goalsOf, upcomingSteps, upNext } from './upNext'

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
		...over,
	}
}

const track = (trackId: string, order: string[], over: Partial<TrackEntry> = {}): TrackEntry => ({
	trackId,
	name: trackId,
	goal: 'g',
	state: 'active',
	order,
	...over,
})

const index = (...entries: IndexEntry[]) => Object.fromEntries(entries.map((e) => [e.itemId, e]))

describe('upNext', () => {
	it('gives each active track its first undone item, skipping done ones', () => {
		const result = upNext([track('t', ['a', 'b', 'c'])], index(item('a', { done: true }), item('b'), item('c')))
		expect(result.steps.map((s) => s.step.itemId)).toEqual(['b'])
	})

	it("walks into a unit to its next undone step, in the steps' order", () => {
		const entries = index(
			item('unit', { hasChildren: true }),
			item('watch', { parentItemId: 'unit', position: 1 }),
			item('read', { parentItemId: 'unit', position: 0, done: true }),
			item('make', { parentItemId: 'unit', position: 2 })
		)
		const [step] = upNext([track('t', ['unit'])], entries).steps
		expect(step!.step.itemId).toBe('watch')
		expect(step!.parent!.itemId).toBe('unit')
	})

	it('leaves out paused tracks and other goals', () => {
		const entries = index(item('a'), item('b'))
		const tracks = [track('t1', ['a'], { state: 'paused' }), track('t2', ['b'], { goal: 'other' })]
		expect(upNext(tracks, entries, 'g').steps).toEqual([])
		expect(upNext(tracks, entries).steps.map((s) => s.track.trackId)).toEqual(['t2'])
	})

	it('counts completed leaves per day for the heatmap', () => {
		const entries = index(
			item('a', { done: true, doneAt: '2026-10-16' }),
			item('b', { done: true, doneAt: '2026-10-16' }),
			item('parent', { done: true, doneAt: '2026-10-16', hasChildren: true })
		)
		expect(upNext([], entries).days.get('2026-10-16')).toBe(2)
	})

	it('collects goals for the filter', () => {
		expect(goalsOf([track('t', [], { goal: 'b' })])).toEqual(['b'])
	})
})

describe('upcomingSteps', () => {
	const it2 = (itemId: string, children: string[] = [], done = false) => ({ itemId, children, done })
	const items = {
		homer: it2('homer', ['iliad', 'odyssey']),
		iliad: it2('iliad', [], true),
		odyssey: it2('odyssey'),
		bible: it2('bible'),
		plato: it2('plato', ['republic', 'symposium', 'phaedo']),
		republic: it2('republic'),
		symposium: it2('symposium'),
		phaedo: it2('phaedo'),
	}

	it('walks the track in reading order, through each entry\'s works, skipping what is done', () => {
		const steps = upcomingSteps(['homer', 'bible', 'plato'], items, 4)
		expect(steps.map((s) => [s.step.itemId, s.entry.itemId])).toEqual([
			['odyssey', 'homer'],
			['bible', 'bible'],
			['republic', 'plato'],
			['symposium', 'plato'],
		])
	})
})
