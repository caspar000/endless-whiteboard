import { beforeEach, describe, expect, it } from 'vitest'
import { getTreeDef, reconcile, removeNodeDef, replaceTreeDefs, resetTreeDefs, setTreeDefsPersistence, upsertNodeDef, type NodeDef } from './treeDefs'

const node = (nodeId: string, over: Partial<NodeDef> = {}): NodeDef => ({
	nodeId,
	name: nodeId,
	kind: 'skill',
	icon: '',
	sector: '',
	ring: '',
	requires: '',
	...over,
})

beforeEach(resetTreeDefs)

describe('tree definitions', () => {
	it('adds, updates and deletes nodes, leaving a tombstone', () => {
		upsertNodeDef('t', node('t/a'))
		upsertNodeDef('t', node('t/a', { name: 'Renamed' }))
		upsertNodeDef('t', node('t/b'))
		expect(getTreeDef('t')!.nodes.map((n) => n.name)).toEqual(['Renamed', 't/b'])
		removeNodeDef('t', 't/a')
		expect(getTreeDef('t')!.nodes.map((n) => n.nodeId)).toEqual(['t/b'])
		expect(getTreeDef('t')!.removed).toEqual(['t/a'])
	})

	it('takes a deleted node back when it is written again, as an undo does', () => {
		upsertNodeDef('t', node('t/a'))
		removeNodeDef('t', 't/a')
		upsertNodeDef('t', node('t/a'))
		expect(getTreeDef('t')!.removed).toEqual([])
	})

	it('reads a stored copy and drops what it cannot', () => {
		replaceTreeDefs({ t: { treeId: 't', nodes: [{ nodeId: 't/a', name: 'A' }, { name: 'no id' }] }, x: { nodes: [] } })
		expect(getTreeDef('t')!.nodes).toEqual([node('t/a', { name: 'A' })])
		expect(getTreeDef('x')).toBeUndefined()
	})
})

describe('the Mastery demo\'s trees', () => {
	it('are deleted on load, with a tombstone for every node, and the vault is told', () => {
		const saved: unknown[] = []
		setTreeDefsPersistence((v) => saved.push(v))
		try {
			replaceTreeDefs({
				craft: { treeId: 'craft', name: 'Craft', mounts: ['mastery/practical'], nodes: [{ nodeId: 'craft/play' }, { nodeId: 'craft/film' }], ticked: { 'craft/play': '2026-10-01' } },
				adler: { treeId: 'adler', name: 'Adler', nodes: [{ nodeId: 'adler/root' }] },
			})
		} finally {
			setTreeDefsPersistence(null)
		}
		expect(getTreeDef('craft')).toMatchObject({ nodes: [], mounts: [], ticked: {}, removed: ['craft/play', 'craft/film'] })
		expect(getTreeDef('adler')!.nodes).toHaveLength(1)
		expect(saved).toHaveLength(1)
		const plan = reconcile(getTreeDef('craft'), new Map([['craft/play', node('craft/play')]]))
		expect(plan.remove).toEqual(['craft/play'])
	})

	it('are kept when someone made them their own', () => {
		replaceTreeDefs({ body: { treeId: 'body', nodes: [{ nodeId: 'body/move' }, { nodeId: 'body/yoga' }] } })
		expect(getTreeDef('body')!.nodes).toHaveLength(2)
	})
})

describe('reconcile', () => {
	it('adopts what the vault has not heard of, removes what it deleted, updates the rest', () => {
		upsertNodeDef('t', node('t/kept', { name: 'From the vault' }))
		upsertNodeDef('t', node('t/gone'))
		removeNodeDef('t', 't/gone')
		const board = new Map([
			['t/kept', node('t/kept', { name: 'Old name' })],
			['t/gone', node('t/gone')],
			['t/new', node('t/new')],
		])
		const plan = reconcile(getTreeDef('t'), board)
		expect(plan.adopt.map((n) => n.nodeId)).toEqual(['t/new'])
		expect(plan.remove).toEqual(['t/gone'])
		expect(plan.update).toEqual([node('t/kept', { name: 'From the vault' })])
	})

	it('adopts a whole board when the vault has no such tree', () => {
		const plan = reconcile(undefined, new Map([['t/a', node('t/a')]]))
		expect(plan).toEqual({ adopt: [node('t/a')], remove: [], update: [] })
	})
})
