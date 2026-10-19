import { describe, expect, it } from 'vitest'
import { measure, SHOW_ALL, WHOLE_LIFE, WHOLE_LIFE_SKILLS, type ShowAll } from './showAll.fixture'
import { wholeLayout } from './wholeLayout'
import { bandBorders } from './bands'
import { DEFAULT_LAYOUT, type LayoutConfig } from './layoutConfig'

/** Placed from the parent: the placement that never lets anything overlap. */
const FROM_PARENT: LayoutConfig = { ...DEFAULT_LAYOUT, placement: 'fromParent' }
const lay = (view: ShowAll, config = FROM_PARENT) => wholeLayout(view.nodes, view.edges, { isSkill: (id) => view.skills.has(id), start: view.start, arrows: view.arrows, config })

describe('wholeLayout', () => {
	for (const view of [WHOLE_LIFE, WHOLE_LIFE_SKILLS, ...SHOW_ALL]) {
		it(`places all of ${view.name} with nothing covering anything`, () => {
			const at = lay(view)
			expect(at.size).toBe(view.nodes.length)
			expect(measure({ ...view, nodes: view.nodes.filter((n) => n.id !== 'header') }, at).overlaps).toEqual([])
		}, 30000)
	}

	it('puts the pillars round you clockwise in their order, Physical at the top', () => {
		const at = lay(WHOLE_LIFE_SKILLS)
		const pillars = ['physical', 'mental', 'spiritual', 'practical', 'social'].map((p) => at.get(`mastery/${p}`)!)
		const angles = pillars.map((p) => Math.atan2(p.y, p.x))
		expect(Math.abs(angles[0]! + Math.PI / 2)).toBeLessThan(0.3)
		// Clockwise on screen is the angle growing, once unwrapped from the first.
		const unwrapped = angles.map((a) => (a < angles[0]! ? a + 2 * Math.PI : a))
		expect([...unwrapped].sort((a, b) => a - b)).toEqual(unwrapped)
	})

	it('keeps every tree in its pillar\'s direction', () => {
		const at = lay(WHOLE_LIFE_SKILLS)
		const dir = (id: string) => Math.atan2(at.get(id)!.y, at.get(id)!.x)
		const off = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))
		expect(off(dir('calisthenics/basics'), dir('mastery/physical'))).toBeLessThan(0.8)
		expect(off(dir('adler/root'), dir('mastery/mental'))).toBeLessThan(0.8)
		expect(off(dir('director/root'), dir('mastery/practical'))).toBeLessThan(0.8)
	})

	it('never puts a skill node in a band further in than its level, and always further out than its parent', () => {
		for (const view of [WHOLE_LIFE, WHOLE_LIFE_SKILLS]) {
			const at = lay(view, DEFAULT_LAYOUT)
			const depth = new Map([[view.start, 0]])
			const parent = new Map<string, string>()
			for (let grew = true; grew; ) {
				grew = false
				for (const e of view.edges)
					if (depth.has(e.from) && !depth.has(e.to) && view.skills.has(e.to)) {
						depth.set(e.to, depth.get(e.from)! + 1)
						parent.set(e.to, e.from)
						grew = true
					}
			}
			const { borders } = bandBorders(DEFAULT_LAYOUT, Math.max(...depth.values()))
			const you = at.get(view.start)!
			const from = (id: string) => Math.hypot(at.get(id)!.x - you.x, at.get(id)!.y - you.y)
			for (const [id, d] of depth) {
				if (d > 1) expect(from(id), id).toBeGreaterThanOrEqual(borders[d - 2]!)
				if (d > 0) expect(from(id), id).toBeGreaterThan(from(parent.get(id)!))
			}
		}
	}, 30000)

	it('is deterministic', () => {
		expect([...lay(WHOLE_LIFE).values()]).toEqual([...lay(WHOLE_LIFE).values()])
	}, 30000)
})
