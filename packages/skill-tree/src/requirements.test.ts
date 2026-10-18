import { describe, expect, it } from 'vitest'
import { evaluateTree, masteryOf, parseRequirements, type TreeNode } from './requirements'
import type { IndexEntry, SkillIndex } from './skillIndex'

function entry(itemId: string, tags: string[], over: Partial<IndexEntry> = {}): IndexEntry {
	return {
		itemId,
		title: itemId,
		kind: 'Study',
		medium: 'book',
		tags,
		done: true,
		doneAt: '2026-10-01',
		evidence: true,
		method: 'analytical',
		core: false,
		parentItemId: '',
		hasChildren: false,
		position: 0,
		...over,
	}
}

const indexOf = (...entries: IndexEntry[]): SkillIndex => Object.fromEntries(entries.map((e) => [e.itemId, e]))

describe('parseRequirements', () => {
	it('reads the four conditions', () => {
		const result = parseRequirements(
			'- node: [a, b]\n- item: x\n- count: { min: 3, kind: Practice }\n- habit: { id: film, rule: streak, min: 4 }'
		)
		expect(result).toEqual({
			ok: true,
			conditions: [
				{ node: ['a', 'b'] },
				{ item: 'x' },
				{ count: { min: 3, kind: 'Practice' } },
				{ habit: { id: 'film', rule: 'streak', min: 4 } },
			],
		})
	})

	it('accepts a single node id without a list, and nothing at all', () => {
		expect(parseRequirements('- node: a')).toEqual({ ok: true, conditions: [{ node: ['a'] }] })
		expect(parseRequirements('  ')).toEqual({ ok: true, conditions: [] })
	})

	it('says what is wrong, and where', () => {
		expect(parseRequirements('node: a')).toMatchObject({ ok: false })
		expect(parseRequirements('- count: { min: 0 }')).toEqual({ ok: false, error: 'Item 1: count needs min: 1 or more' })
		expect(parseRequirements('- [unclosed')).toMatchObject({ ok: false })
	})
})

describe('evaluateTree', () => {
	const tree: TreeNode[] = [
		{ nodeId: 'root', name: 'Root', requires: '' },
		{ nodeId: 'drama', name: 'Drama', requires: '- node: [root]\n- count: { min: 2 }' },
		{ nodeId: 'tragedy', name: 'Tragedy', requires: '- node: [drama]\n- count: { min: 1 }' },
	]

	it('opens a node with no requirement, and the next ring in reach of it', () => {
		const status = evaluateTree(tree, {})
		expect(status.get('root')!.state).toBe('unlocked')
		expect(status.get('drama')!.state).toBe('available')
		expect(status.get('tragedy')!.state).toBe('locked')
	})

	it('unlocks on enough tagged evidence and passes the unlock down the chain', () => {
		const status = evaluateTree(tree, indexOf(entry('a', ['drama']), entry('b', ['drama'])))
		expect(status.get('drama')!.state).toBe('unlocked')
		expect(status.get('tragedy')!.state).toBe('available')
	})

	it('ignores ticks without evidence', () => {
		const status = evaluateTree(tree, indexOf(entry('a', ['drama']), entry('b', ['drama'], { evidence: false })))
		expect(status.get('drama')!.state).toBe('available')
		expect(status.get('drama')!.conditions[1]).toMatchObject({ have: 1, need: 2, met: false })
	})

	it('filters counts by kind, medium and method', () => {
		const nodes: TreeNode[] = [{ nodeId: 'n', name: 'N', requires: '- count: { min: 1, kind: Practice, method: practice }' }]
		expect(evaluateTree(nodes, indexOf(entry('a', ['n']))).get('n')!.state).toBe('available')
		expect(evaluateTree(nodes, indexOf(entry('a', ['n'], { kind: 'Practice', method: 'practice' }))).get('n')!.state).toBe('unlocked')
	})

	it('lets a method node count evidence from anywhere in its tree, by method', () => {
		const nodes: TreeNode[] = [
			...tree,
			{ nodeId: 'reading', name: 'Reading', kind: 'method', requires: '- count: { min: 2, method: analytical }' },
		]
		const status = evaluateTree(nodes, indexOf(entry('a', ['drama']), entry('b', ['tragedy']), entry('c', ['elsewhere'])))
		expect(status.get('reading')!.conditions[0]).toMatchObject({ have: 2, need: 2, met: true })
	})

	it('keeps cycles and unknown prerequisites locked instead of looping', () => {
		const nodes: TreeNode[] = [
			{ nodeId: 'a', name: 'A', requires: '- node: [b]' },
			{ nodeId: 'b', name: 'B', requires: '- node: [a]' },
			{ nodeId: 'c', name: 'C', requires: '- node: [nowhere]' },
		]
		const status = evaluateTree(nodes, {})
		expect(status.get('a')!.state).toBe('locked')
		expect(status.get('c')!.state).toBe('locked')
	})

	it('counts mastery from the evidence beyond what unlocking used', () => {
		const pieces = Array.from({ length: 6 }, (_, i) => entry(`e${i}`, ['drama'], { doneAt: `2026-10-0${i + 1}`, kind: i === 5 ? 'Ship' : 'Study' }))
		const drama = evaluateTree(tree, indexOf(...pieces)).get('drama')!
		expect(drama.mastery.count).toBe(4)
		expect(drama.mastery.ships).toBe(1)
		expect(drama.mastery.tier).toBe(1)
	})
})

describe('masteryOf', () => {
	const pieces = (n: number, ships: number) =>
		Array.from({ length: n }, (_, i) => entry(`m${i}`, [], { kind: i < ships ? 'Ship' : 'Study' }))

	it('needs a Ship for every tier', () => {
		expect(masteryOf(pieces(3, 0)).tier).toBe(0)
		expect(masteryOf(pieces(3, 1)).tier).toBe(1)
		expect(masteryOf(pieces(10, 1)).tier).toBe(1)
		expect(masteryOf(pieces(10, 2)).tier).toBe(2)
		expect(masteryOf(pieces(30, 3))).toMatchObject({ tier: 3, nextAt: null })
	})
})

describe('evaluateTree across trees', () => {
	const tree = (requires: string): TreeNode[] => [
		{ nodeId: 'm/sit', name: 'Sit', requires: '', kind: 'root' },
		{ nodeId: 'm/steady', name: 'Steady', requires },
	]
	const unlocked = { state: 'unlocked' } as ReturnType<typeof evaluateTree> extends Map<string, infer S> ? S : never

	it("asks for the state of another tree's node", () => {
		const status = evaluateTree(tree('- node: [m/sit, a/single]'), {}, {}, '2026-10-18', (id) => (id === 'a/single' ? unlocked : undefined))
		expect(status.get('m/steady')!.conditions[0]).toMatchObject({ have: 2, need: 2, met: true })
	})

	it("counts another tree's node as locked when nothing answers for it", () => {
		const status = evaluateTree(tree('- node: [m/sit, a/single]'), {}, {}, '2026-10-18')
		expect(status.get('m/steady')!.conditions[0]).toMatchObject({ have: 1, need: 2, met: false })
	})
})
