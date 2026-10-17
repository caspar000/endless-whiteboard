import { describe, expect, it } from 'vitest'
import type { NodeDef, TreeDef, TreeDefs } from './treeDefs'
import { reachFrom, rootOfTree, treeGraph, viewStart } from './views'

const node = (nodeId: string, requires: string[] = [], kind = 'skill'): NodeDef => ({
	nodeId,
	name: nodeId,
	kind,
	icon: '',
	sector: '',
	ring: '',
	requires: requires.length ? `- node: [${requires.join(', ')}]` : '',
})
const tree = (treeId: string, nodes: NodeDef[], mount = ''): TreeDef => ({ treeId, name: treeId, goal: '', sectors: '', rings: '', mount, nodes, removed: [] })

/** Mastery, two pillars, a tree on each pillar, and a tree hanging from nothing. */
const VAULT: TreeDefs = {
	mastery: tree('mastery', [node('mastery/root', [], 'mastery'), node('mastery/mental', ['mastery/root'], 'pillar'), node('mastery/physical', ['mastery/root'], 'pillar')]),
	adler: tree('adler', [node('adler/root', [], 'root'), node('adler/epic', ['adler/root']), node('adler/method', [], 'method')], 'mastery/mental'),
	body: tree('body', [node('body/train'), node('body/strength', ['body/train'])], 'mastery/physical'),
	loose: tree('loose', [node('loose/a')]),
}

describe('treeGraph', () => {
	it('finds each root, hangs loose nodes from it, and mounts trees on their node', () => {
		const g = treeGraph(VAULT)
		expect(g.rootOf.get('adler')).toBe('adler/root')
		expect(g.rootOf.get('body')).toBe('body/train')
		expect(g.loose).toContainEqual({ from: 'adler/root', to: 'adler/method' })
		expect(g.mounts).toEqual([
			{ from: 'mastery/mental', to: 'adler/root', treeId: 'adler' },
			{ from: 'mastery/physical', to: 'body/train', treeId: 'body' },
		])
	})

	it('ignores a mount on a missing node or on the tree itself', () => {
		const g = treeGraph({ a: tree('a', [node('a/x')], 'nowhere'), b: tree('b', [node('b/x')], 'b/x') })
		expect(g.mounts).toEqual([])
	})
})

describe('reachFrom', () => {
	it('from Mastery reaches every pillar and every tree mounted on them, not the unmounted one', () => {
		const reach = reachFrom(treeGraph(VAULT), 'mastery/root')
		expect([...reach].sort()).toEqual(
			['mastery/root', 'mastery/mental', 'mastery/physical', 'adler/root', 'adler/epic', 'adler/method', 'body/train', 'body/strength'].sort()
		)
	})

	it('from a pillar reaches only that pillar and its trees', () => {
		expect([...reachFrom(treeGraph(VAULT), 'mastery/physical')].sort()).toEqual(['body/strength', 'body/train', 'mastery/physical'])
	})
})

describe('viewStart and rootOfTree', () => {
	it('starts at the chosen root, else the tree root', () => {
		const g = treeGraph(VAULT)
		expect(viewStart(g, { treeId: 'adler', root: '' })).toBe('adler/root')
		expect(viewStart(g, { treeId: 'adler', root: 'adler/epic' })).toBe('adler/epic')
		expect(viewStart(g, { treeId: 'adler', root: 'gone' })).toBe('adler/root')
	})

	it('prefers a node of kind root or mastery, then one without prerequisites', () => {
		expect(rootOfTree([node('x/a', ['x/b']), node('x/b')])).toBe('x/b')
		expect(rootOfTree([node('x/a'), node('x/b', [], 'root')])).toBe('x/b')
	})
})
