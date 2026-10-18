import { describe, expect, it } from 'vitest'
import { compactLayout } from './compact'
import { HEADER, measure, SHOW_ALL, type ShowAll } from './showAll.fixture'

const lay = (view: ShowAll) => compactLayout(view.nodes, view.edges, { isSkill: (id) => view.skills.has(id), start: view.start, unlined: new Set([HEADER]) })

/** Show all on the content files, laid out as `layoutView` does it. */
describe('compactLayout', () => {
	for (const view of SHOW_ALL) {
		it(`lays ${view.name} out compact, nothing covered, no tree arrow through a node`, () => {
			const at = lay(view)
			expect(at.size).toBe(view.nodes.length)
			// The arrows the tree grows along; a cross-link between branches may still cross something.
			const tree = view.arrows.filter((a) => view.edges.some((e) => (e.from === a.from && e.to === a.to) || (e.from === a.to && e.to === a.from)))
			const m = measure({ ...view, arrows: tree }, at)
			expect(m.overlaps).toEqual([])
			expect(m.arrowsThrough).toBe(0)
			// The old ring layout covered about 2% of its bounding box.
			expect(m.fill).toBeGreaterThan(9)
		})
	}

	it('keeps an entry\'s works close around it', () => {
		const view = SHOW_ALL[0]!
		const at = lay(view)
		const hegel = at.get('item:adler/088-georg-wilhelm-friedrich-hegel')!
		const works = view.edges.filter((e) => e.from === 'item:adler/088-georg-wilhelm-friedrich-hegel').map((e) => at.get(e.to)!)
		expect(works).toHaveLength(3)
		for (const w of works) expect(Math.hypot(w.x - hegel.x, w.y - hegel.y)).toBeLessThan(220)
	})

	it('is deterministic', () => {
		const view = SHOW_ALL[1]!
		expect([...lay(view).values()]).toEqual([...lay(view).values()])
	})
})
