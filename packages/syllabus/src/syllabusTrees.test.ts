import { evaluateTree, getTreeDef, makeTrees, replaceTreeDefs } from '@lifeboard/skill-tree'
import { beforeEach, describe, expect, it } from 'vitest'
import { getItem, getTracks, putItems, putTracks, resetSyllabus, setDone, type ItemDef, type TrackDef } from './syllabus'
import { deleteSyllabus, makerId, pathTree, syllabusMakers, treesGoingWith } from './syllabusTrees'
import { parseSyllabus } from './syllabusYaml'
import { confirmTreePlans, getTreePlans, keepTreePlans, resetTreePlans } from './treePlans'

const item = (itemId: string, over: Partial<ItemDef> = {}): ItemDef => ({
	itemId,
	title: itemId,
	kind: 'Study',
	medium: 'book',
	tags: [],
	core: false,
	childRule: 'all',
	parent: '',
	children: [],
	done: false,
	doneAt: '',
	draft: '',
	...over,
})

const track = (trackId: string, name: string, order: string[]): TrackDef => ({ trackId, name, goal: '', state: 'active', order, defaultTags: [], draft: '' })

/** Adler's first two entries: Homer, with two works, and Plato, ticked by itself. */
function adler() {
	putItems([
		item('a/homer', { title: 'Homer', children: ['a/homer/iliad', 'a/homer/odyssey'] }),
		item('a/homer/iliad', { parent: 'a/homer', medium: 'work' }),
		item('a/homer/odyssey', { parent: 'a/homer', medium: 'work' }),
		item('a/plato', { title: 'Plato' }),
	])
	putTracks([track('a/canon', 'Canon', ['a/homer', 'a/plato'])])
}

const states = (treeId: string) => {
	const tree = getTreeDef(treeId)!
	const status = evaluateTree(tree.nodes, [])
	return Object.fromEntries(tree.nodes.map((n) => [n.name, status.get(n.nodeId)!.state]))
}

beforeEach(() => {
	resetSyllabus()
	resetTreePlans()
	replaceTreeDefs({})
})

describe('a tree made from a syllabus', () => {
	it('is a path of its entries from a root named for it', () => {
		adler()
		const tree = pathTree(getTracks()['a/canon']!)
		expect(tree.treeId).toBe('a-canon')
		expect(tree.nodes.map((n) => [n.nodeId, n.after])).toEqual([
			['a-canon/root', ''],
			['a-canon/homer', 'a-canon/root'],
			['a-canon/plato', 'a-canon/homer'],
		])
		expect(tree.nodes[1]).toMatchObject({ name: 'Homer', icon: 'book', requires: '- done: "a/homer"', item: 'a/homer' })
	})

	it('lights each entry once it is done, in any order, and tags the entry to its node', () => {
		adler()
		makeTrees([makerId('a/canon')])
		expect(getItem('a/homer')!.tags).toEqual(['a-canon/homer'])
		// Nothing gates: Plato is in reach before Homer is done.
		expect(states('a-canon')).toEqual({ Canon: 'unlocked', Homer: 'available', Plato: 'available' })
		setDone('a/plato', true)
		expect(states('a-canon')).toMatchObject({ Homer: 'available', Plato: 'unlocked' })
		setDone('a/homer/odyssey', true)
		setDone('a/homer/iliad', true)
		expect(states('a-canon')).toMatchObject({ Homer: 'unlocked' })
	})

	it("is the file's own tree when the file came with one, made once for every track it feeds", () => {
		const parsed = parseSyllabus(`
goal: film
name: Film
tracks:
  - { id: craft, name: Craft, items: [{ id: shot, title: The shot }] }
  - { id: canon, name: Canon, items: [{ id: kane, title: Citizen Kane }] }
tree:
  id: film
  name: Film
  mount: mastery/practical
  nodes:
    - { id: root, name: Film, kind: root }
    - { id: editing, name: Editing, requires: [{ node: [root] }] }
`)
		if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
		putTracks(parsed.doc.tracks.map((t) => track(t.trackId, t.name, t.order)))
		keepTreePlans(parsed.doc.trees, ['film/craft', 'film/canon'], 'board-1')
		// A draft's tree is not offered until the import is confirmed.
		expect(syllabusMakers().find((m) => m.id === makerId('film/craft'))!.make()!.trees[0]!.treeId).not.toBe('film')
		confirmTreePlans('board-1')
		expect(makeTrees([makerId('film/craft')]).made).toEqual(['film'])
		expect(getTreeDef('film')).toMatchObject({ mounts: [], madeFrom: [makerId('film/craft'), makerId('film/canon')] })
		expect(getTreeDef('film')!.nodes.map((n) => n.nodeId)).toEqual(['film/root', 'film/editing'])
		expect(makeTrees([makerId('film/canon')]).already).toEqual(['film'])

		// Deleting one syllabus leaves the tree the other still feeds; deleting the last takes it.
		expect(treesGoingWith('film/craft')).toEqual([])
		deleteSyllabus('film/craft')
		expect(getTreeDef('film')!.deleted).toBe(false)
		expect(treesGoingWith('film/canon').map((t) => t.treeId)).toEqual(['film'])
		deleteSyllabus('film/canon')
		expect(getTreeDef('film')!.deleted).toBe(true)
		expect(getTreePlans()).toEqual({})
	})

	it('takes over the tree an old import left under the goal', () => {
		adler()
		replaceTreeDefs({ a: { treeId: 'a', name: 'Adler', nodes: [{ nodeId: 'a/root', name: 'Adler', kind: 'root' }] } })
		expect(makeTrees([makerId('a/canon')]).made).toEqual(['a'])
		expect(getTreeDef('a')!.madeFrom).toEqual([makerId('a/canon')])
		expect(getTreeDef('a-canon')).toBeUndefined()
	})

	it('goes when its syllabus is deleted', () => {
		adler()
		makeTrees([makerId('a/canon')])
		deleteSyllabus('a/canon')
		expect(getTreeDef('a-canon')!.deleted).toBe(true)
	})
})
