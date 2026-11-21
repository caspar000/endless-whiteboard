import { describe, expect, it } from 'vitest'
import { conditionFraction, evaluateTree, parseRequirements, type TreeNode } from './requirements'
import { registerTreeSource } from './sources'

/** A kind of requirement as a source would add one: met when the node has at least `min` pieces of evidence. */
registerTreeSource({
	id: 'test:pieces',
	requirements: [
		{
			key: 'pieces',
			parse: (value) => (typeof value === 'number' && value > 0 ? { ok: true, value } : { ok: false, error: 'pieces takes a number' }),
			evaluate: (value, node) => ({ label: `${value} pieces`, have: Math.min(node.evidence.length, value as number), need: value as number, met: node.evidence.length >= (value as number), consumed: value as number }),
		},
	],
})

const piece = (id: string, tags: string[]) => ({ id, title: id, doneAt: '2026-10-01', kind: 'Study', medium: '', method: '', tags })

describe('requirements', () => {
	it('reads node and manual, and a kind a source registered', () => {
		expect(parseRequirements('- node: [a]\n- manual: Read it\n- pieces: 2')).toEqual({
			ok: true,
			conditions: [
				{ key: 'node', value: ['a'] },
				{ key: 'manual', value: 'Read it' },
				{ key: 'pieces', value: 2 },
			],
		})
		expect(parseRequirements('- node: a')).toEqual({ ok: true, conditions: [{ key: 'node', value: ['a'] }] })
		expect(parseRequirements('  ')).toEqual({ ok: true, conditions: [] })
	})

	it("says what is wrong: the source's own error, or a kind nothing registered", () => {
		expect(parseRequirements('node: a')).toMatchObject({ ok: false })
		expect(parseRequirements('- pieces: none')).toEqual({ ok: false, error: 'Item 1: pieces takes a number' })
		expect(parseRequirements('- habit: { id: h }')).toMatchObject({ ok: false, error: expect.stringMatching(/unknown requirement "habit"/) })
	})

	const tree: TreeNode[] = [
		{ nodeId: 'root', name: 'Root', requires: '' },
		{ nodeId: 'drama', name: 'Drama', requires: '- node: [root]\n- pieces: 2' },
		{ nodeId: 'tragedy', name: 'Tragedy', requires: '- node: [drama]\n- manual: Saw one' },
	]

	it("follows prerequisites, and asks the source's kind for the rest", () => {
		const none = evaluateTree(tree, [])
		expect([none.get('root')!.state, none.get('drama')!.state, none.get('tragedy')!.state]).toEqual(['unlocked', 'available', 'locked'])
		const two = evaluateTree(tree, [piece('a', ['drama']), piece('b', ['drama'])])
		expect(two.get('drama')!.state).toBe('unlocked')
		expect(two.get('tragedy')!.state).toBe('available')
	})

	it('unlocks a manual node once it is ticked by hand', () => {
		const ticked = tree.map((n) => (n.nodeId === 'tragedy' ? { ...n, tickedAt: '2026-10-25' } : n))
		const status = evaluateTree(ticked, [piece('a', ['drama']), piece('b', ['drama'])])
		expect(status.get('tragedy')).toMatchObject({ state: 'unlocked', conditions: [{ met: true }, { label: 'Saw one', met: true }] })
	})

	it('keeps cycles and unknown prerequisites locked instead of looping', () => {
		const nodes: TreeNode[] = [
			{ nodeId: 'a', name: 'A', requires: '- node: [b]' },
			{ nodeId: 'b', name: 'B', requires: '- node: [a]' },
			{ nodeId: 'c', name: 'C', requires: '- node: [nowhere]' },
		]
		const status = evaluateTree(nodes, [])
		expect(status.get('a')!.state).toBe('locked')
		expect(status.get('c')!.state).toBe('locked')
	})

	const sit = [
		{ nodeId: 'm/sit', name: 'Sit', requires: '', kind: 'root' },
		{ nodeId: 'm/steady', name: 'Steady', requires: '- node: [m/sit, a/single]' },
	]
	const unlocked = { state: 'unlocked' } as ReturnType<typeof evaluateTree> extends Map<string, infer S> ? S : never

	it("asks for the state of another tree's node, and counts it locked when nothing answers", () => {
		expect(evaluateTree(sit, [], (id) => (id === 'a/single' ? unlocked : undefined)).get('m/steady')!.conditions[0]).toMatchObject({ have: 2, need: 2, met: true })
		expect(evaluateTree(sit, []).get('m/steady')!.conditions[0]).toMatchObject({ have: 1, need: 2, met: false })
	})

	/*
	 * DARK-10. /mu/core's genres hang from a category and ask for albums: in reach as soon as the
	 * category is, but nothing done until an album is. The ring shows the albums, not the category.
	 */
	describe('the ring of a node in reach', () => {
		const genres: TreeNode[] = [
			{ nodeId: 'root', name: 'Listen Widely', requires: '' },
			{ nodeId: 'african', name: 'Sub-Saharan African', requires: '- node: [root]' },
			{ nodeId: 'indian-ocean', name: 'Indian Ocean', requires: '- node: [african]\n- pieces: 1' },
			{ nodeId: 'punk', name: 'Punk', requires: '- node: [african]\n- pieces: 4' },
			{ nodeId: 'ticked', name: 'Ticked', requires: '- node: [root]\n- manual: Heard it' },
		]
		const ring = (nodeId: string, evidence: ReturnType<typeof piece>[] = []) => conditionFraction(evaluateTree(genres, evidence).get(nodeId)!)
		const albums = (n: number, tag: string) => Array.from({ length: n }, (_, i) => piece(`${tag}-${i}`, [tag]))

		it('is empty while nothing is done, its prerequisites met or not', () => {
			expect(evaluateTree(genres, []).get('indian-ocean')!.state).toBe('available')
			expect(ring('indian-ocean')).toBe(0)
			expect(ring('punk')).toBe(0)
			expect(ring('ticked')).toBe(0)
		})

		it('fills with what is done, and is full once the node is met', () => {
			expect(ring('punk', albums(1, 'punk'))).toBe(0.25)
			expect(ring('punk', albums(3, 'punk'))).toBe(0.75)
			expect(ring('punk', albums(4, 'punk'))).toBe(1)
			expect(ring('indian-ocean', albums(1, 'indian-ocean'))).toBe(1)
		})

		it('still lists the prerequisite among the conditions', () => {
			expect(evaluateTree(genres, []).get('punk')!.conditions).toEqual([
				{ label: 'Unlock Sub-Saharan African', have: 1, need: 1, met: true, prerequisite: true },
				{ label: '4 pieces', have: 0, need: 4, met: false },
			])
		})
	})
})
