import { beforeEach, describe, expect, it } from 'vitest'
import { registerTreeSource } from './sources'
import { deleteTreeDefs, forgetMaker, getTreeDef, reconcile, replaceTreeDefs, resetTreeDefs, upsertNodeDef, upsertNodeDefs, type NodeDef } from './treeDefs'
import { makeTrees } from './treeMaking'
import type { DocNode, DocTree } from './treeYaml'
import { rootOfTree, treeGraph, viewContents } from './views'
import { getTreeDefs } from './treeDefs'

const node = (nodeId: string, over: Partial<NodeDef> = {}): NodeDef => ({ nodeId, name: nodeId, kind: 'skill', icon: '', sector: '', ring: '', requires: '', ...over })
const docNode = (nodeId: string, over: Partial<DocNode> = {}): DocNode => ({ nodeId, name: nodeId, kind: 'skill', icon: '', sector: '', ring: '', requires: '', after: '', item: '', ...over })
const doc = (treeId: string, nodes: DocNode[], mounts: string[] = []): DocTree => ({ treeId, name: treeId.toUpperCase(), goal: '', layout: 'sectors', sectors: [], rings: [], mounts, nodes })

/** A source offering three things to make trees from; `b` and `c` feed one tree, as Film's tracks do. */
let tagged: string[] = []
registerTreeSource({
	id: 'test',
	makers: () => [
		{ id: 'test:a', name: 'A', group: 'Tests', make: () => ({ trees: [doc('a', [docNode('a/root', { kind: 'root' }), docNode('a/one', { after: 'a/root' })], ['mastery/mental'])], from: ['test:a'] }), made: (trees) => void tagged.push(...trees.map((t) => t.treeId)) },
		{ id: 'test:b', name: 'B', group: 'Tests', make: () => ({ trees: [doc('bc', [docNode('bc/root', { kind: 'root' })])], from: ['test:b', 'test:c'] }) },
		{ id: 'test:c', name: 'C', group: 'Tests', make: () => ({ trees: [doc('bc', [docNode('bc/root', { kind: 'root' })])], from: ['test:b', 'test:c'] }) },
	],
})

beforeEach(() => {
	resetTreeDefs()
	tagged = []
})

describe('making trees', () => {
	it('makes a tree on nothing and under nothing, remembering what it was made from', () => {
		expect(makeTrees(['test:a'])).toEqual({ made: ['a'], already: [] })
		const a = getTreeDef('a')!
		expect(a.nodes.map((n) => n.nodeId)).toEqual(['a/root', 'a/one'])
		// The file said mastery/mental; hanging it is asked for separately.
		expect(a.mounts).toEqual([])
		expect(a.madeFrom).toEqual(['test:a'])
		expect(tagged).toEqual(['a'])
	})

	it('makes a tree two makers share once, and says so the second time', () => {
		expect(makeTrees(['test:b', 'test:c']).made).toEqual(['bc'])
		expect(getTreeDef('bc')!.madeFrom).toEqual(['test:b', 'test:c'])
		expect(makeTrees(['test:c'])).toEqual({ made: [], already: ['bc'] })
	})

	it('hangs several from a shared root, made from all of them', () => {
		const result = makeTrees(['test:a', 'test:b'], { name: 'Arts', sharedRoot: true })
		expect(result.made).toEqual(['arts', 'a', 'bc'])
		expect(getTreeDef('arts')!.nodes.map((n) => [n.nodeId, n.kind])).toEqual([['arts/root', 'root']])
		expect(getTreeDef('arts')!.madeFrom).toEqual(['test:a', 'test:b', 'test:c'])
		expect(getTreeDef('a')!.mounts).toEqual(['arts/root'])
		expect(getTreeDef('bc')!.mounts).toEqual(['arts/root'])
	})

	it('makes an empty tree: a root with the name given', () => {
		expect(makeTrees([], { name: 'Cooking' }).made).toEqual(['cooking'])
		expect(getTreeDef('cooking')!.nodes).toEqual([node('cooking/root', { name: 'Cooking', kind: 'root' })])
		expect(() => makeTrees([])).toThrow()
	})

	it('takes over a tree an old import left under the same id, keeping where it hangs', () => {
		upsertNodeDefs('a', [node('a/root', { kind: 'root' }), node('a/old')])
		replaceTreeDefs({ a: { ...getTreeDef('a')!, mounts: ['mastery/practical'] } })
		makeTrees(['test:a'])
		expect(getTreeDef('a')!.nodes.map((n) => n.nodeId)).toEqual(['a/root', 'a/old', 'a/one'])
		expect(getTreeDef('a')!.mounts).toEqual(['mastery/practical'])
		expect(getTreeDef('a')!.madeFrom).toEqual(['test:a'])
	})
})

describe('deleting trees', () => {
	it('leaves a tombstone every board drops the shapes of, and making it again brings it back', () => {
		makeTrees(['test:a'])
		expect(deleteTreeDefs(['a'])).toEqual(['a'])
		const gone = getTreeDef('a')!
		expect(gone).toMatchObject({ deleted: true, nodes: [], madeFrom: [] })
		expect(gone.removed).toEqual(['a/root', 'a/one'])
		// Even a shape the vault never heard of goes, rather than bringing the tree back.
		expect(reconcile(gone, new Map([['a/one', node('a/one')], ['a/offline', node('a/offline')]])).remove).toEqual(['a/one', 'a/offline'])
		makeTrees(['test:a'])
		expect(getTreeDef('a')).toMatchObject({ deleted: false, removed: [] })
	})

	it('takes the branches of a shared root with it, and only unhangs a tree hung there by hand', () => {
		makeTrees(['test:a', 'test:b'], { name: 'Arts', sharedRoot: true })
		upsertNodeDef('mine', node('mine/root', { kind: 'root' }))
		replaceTreeDefs({ ...getTreeDefs(), mine: { ...getTreeDef('mine')!, mounts: ['arts/root'] } })
		expect(deleteTreeDefs(['arts']).sort()).toEqual(['a', 'arts', 'bc'])
		expect(getTreeDef('mine')).toMatchObject({ deleted: false, mounts: [] })
	})

	it('goes with the last thing it was made from', () => {
		makeTrees(['test:b'])
		expect(forgetMaker('test:b')).toEqual([])
		expect(getTreeDef('bc')!.madeFrom).toEqual(['test:c'])
		expect(forgetMaker('test:c')).toEqual(['bc'])
		expect(getTreeDef('bc')!.deleted).toBe(true)
	})

	it('never takes a tree nobody made (an empty one, an old import)', () => {
		makeTrees([], { name: 'Cooking' })
		expect(forgetMaker('test:a')).toEqual([])
		expect(getTreeDef('cooking')!.deleted).toBe(false)
	})
})

describe('a path', () => {
	it('grows each node from the one before without asking anything of it', () => {
		upsertNodeDefs('p', [node('p/root', { kind: 'root' }), node('p/one', { after: 'p/root' }), node('p/two', { after: 'p/one' })])
		const graph = treeGraph(getTreeDefs())
		expect(graph.prerequisites).toEqual([
			{ from: 'p/root', to: 'p/one' },
			{ from: 'p/one', to: 'p/two' },
		])
		expect(graph.loose).toEqual([])
		expect(rootOfTree(getTreeDef('p')!.nodes)).toBe('p/root')
	})

	it("hangs the works of the entry a node stands for from the node, not the entry beside it", () => {
		upsertNodeDefs('p', [node('p/root', { kind: 'root' }), node('p/homer', { after: 'p/root', item: 'homer' })])
		const items = {
			homer: { itemId: 'homer', parent: '', children: ['iliad'], tags: ['p/homer'] },
			iliad: { itemId: 'iliad', parent: 'homer', children: [], tags: [] },
		}
		const view = viewContents(treeGraph(getTreeDefs()), items, { treeId: 'p', root: '', mode: 'all' })
		expect([...view.items]).toEqual([['iliad', { parent: 'p/homer', variant: 'entry' }]])
	})

	it('keeps its path through an edit from a board, whose shapes carry none', () => {
		upsertNodeDef('p', node('p/one', { after: 'p/root', item: 'one' }))
		upsertNodeDef('p', node('p/one', { name: 'Renamed' }))
		expect(getTreeDef('p')!.nodes[0]).toMatchObject({ name: 'Renamed', after: 'p/root', item: 'one' })
	})
})
