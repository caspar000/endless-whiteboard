import { beforeEach, describe, expect, it } from 'vitest'
import { addPillar, ensureMastery, hangTree, movePillar, pillarsOf, removePillar, renamePillar, treesUnder } from './mastery'
import { getTreeDef, getTreeDefs, resetTreeDefs, upsertNodeDefs } from './treeDefs'
import { reachFrom, treeGraph } from './views'

const names = () => pillarsOf().map((p) => p.name)

describe('Mastery', () => {
	beforeEach(() => {
		resetTreeDefs()
		upsertNodeDefs('film', [{ nodeId: 'film/root', name: 'Film', kind: 'root', icon: '', sector: '', ring: '', requires: '' }])
	})

	it('starts as you and five pillars, once', () => {
		ensureMastery()
		ensureMastery()
		expect(getTreeDef('mastery')!.nodes[0]).toMatchObject({ nodeId: 'mastery/root', name: 'You', kind: 'mastery' })
		expect(names()).toEqual(['Physical', 'Mental', 'Spiritual', 'Practical', 'Social'])
	})

	it('adds, renames, moves and removes pillars', () => {
		ensureMastery()
		const craft = addPillar('Craft')
		expect(craft).toBe('mastery/craft')
		expect(addPillar('Craft')).toBe('mastery/craft-2')
		renamePillar(craft, 'Making')
		movePillar(craft, -1)
		expect(names().slice(-3)).toEqual(['Making', 'Social', 'Craft'])
		removePillar('mastery/craft-2')
		expect(names()).toEqual(['Physical', 'Mental', 'Spiritual', 'Practical', 'Making', 'Social'])
	})

	it('hangs a tree under several pillars, and a view of either reaches it', () => {
		ensureMastery()
		hangTree('film', 'mastery/practical', true)
		hangTree('film', 'mastery/mental', true)
		expect(getTreeDef('film')!.mounts).toEqual(['mastery/practical', 'mastery/mental'])
		expect(treesUnder('mastery/mental').map((t) => t.treeId)).toEqual(['film'])
		const graph = treeGraph(getTreeDefs())
		expect(graph.mounts.filter((m) => m.treeId === 'film').map((m) => m.from)).toEqual(['mastery/practical', 'mastery/mental'])
		expect(reachFrom(graph, 'mastery/mental').has('film/root')).toBe(true)
		hangTree('film', 'mastery/practical', false)
		expect(getTreeDef('film')!.mounts).toEqual(['mastery/mental'])
	})

	it('takes a removed pillar off the trees under it', () => {
		ensureMastery()
		hangTree('film', 'mastery/social', true)
		removePillar('mastery/social')
		expect(getTreeDef('film')!.mounts).toEqual([])
	})
})
