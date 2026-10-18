import { describe, expect, it } from 'vitest'
import { clusterLayout } from './clusters'
import { HEADER, measure, SHOW_ALL } from './showAll.fixture'

/** Show all on the content files, laid out as `layoutView` does it. */
describe('clusterLayout', () => {
	for (const view of SHOW_ALL) {
		it(`lays ${view.name} out with nothing covered and no line through a node`, () => {
			const at = clusterLayout(view.nodes, view.edges, { isSkill: (id) => view.skills.has(id), start: view.start, arrows: view.arrows, unlined: new Set([HEADER]) })
			expect(at.size).toBe(view.nodes.length)
			const m = measure(view, at)
			expect(m.overlaps).toEqual([])
			expect(m.linesThrough).toBe(0)
		})
	}

	it('stacks an entry\'s works in a column beside it, close', () => {
		const view = SHOW_ALL[0]!
		const at = clusterLayout(view.nodes, view.edges, { isSkill: (id) => view.skills.has(id), start: view.start, arrows: view.arrows, unlined: new Set([HEADER]) })
		const hegel = at.get('item:adler/088-georg-wilhelm-friedrich-hegel')!
		const works = view.edges.filter((e) => e.from === 'item:adler/088-georg-wilhelm-friedrich-hegel').map((e) => at.get(e.to)!)
		expect(works).toHaveLength(3)
		// One column: the same x, one row apart, all within reach of the entry.
		expect(new Set(works.map((w) => Math.round(w.x))).size).toBe(1)
		for (const w of works) expect(Math.hypot(w.x - hegel.x, w.y - hegel.y)).toBeLessThan(240)
	})

	it('is deterministic', () => {
		const view = SHOW_ALL[1]!
		const run = () => [...clusterLayout(view.nodes, view.edges, { isSkill: (id) => view.skills.has(id), start: view.start, arrows: view.arrows }).values()]
		expect(run()).toEqual(run())
	})
})
