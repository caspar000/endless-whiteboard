import { describe, expect, it } from 'vitest'
import type { NodeStatus } from '../requirements'
import type { TreeItem, TreeItemLook } from '../sources'
import type { NodeDef, TreeDef, TreeDefs } from '../treeDefs'
import { treeGraph } from '../views'
import { fillsOf, formatFill, sharesOf, worksByNode, type Works } from './fill'

const node = (nodeId: string, requires: string[] = [], kind = 'skill', extra: Partial<NodeDef> = {}): NodeDef => ({
	nodeId,
	name: nodeId,
	kind,
	icon: '',
	sector: '',
	ring: '',
	requires: requires.length ? `- node: [${requires.join(', ')}]` : '',
	...extra,
})
const tree = (treeId: string, nodes: NodeDef[], ...mounts: string[]): TreeDef => ({ treeId, name: treeId, goal: '', sectors: '', rings: '', mounts, nodes, removed: [], draft: '', ticked: {}, madeFrom: [], deleted: false })

const unlocked: NodeStatus = { state: 'unlocked', conditions: [], evidence: [], mastery: { count: 0, tier: 0, nextAt: 3, ships: 0 } }
const ticked = (done: boolean): NodeStatus => ({ ...unlocked, state: done ? 'unlocked' : 'available', conditions: [{ label: 'Ticked by hand', have: done ? 1 : 0, need: 1, met: done }] })

const fills = (trees: TreeDefs, works: Record<string, Works> = {}, statuses: Record<string, NodeStatus> = {}) =>
	fillsOf(treeGraph(trees), new Map(Object.entries(works)), (id) => statuses[id] ?? unlocked)

describe('fillsOf', () => {
	it('makes each node under a parent an equal share, at every depth', () => {
		const trees = {
			music: tree('music', [
				node('music/root', [], 'root'),
				node('music/classical', ['music/root'], 'pillar'),
				node('music/jazz', ['music/root'], 'pillar'),
				node('music/romantic', ['music/classical']),
				node('music/baroque', ['music/classical']),
			]),
		}
		const f = fills(trees, { 'music/romantic': { done: 1, total: 25 }, 'music/baroque': { done: 0, total: 20 } })
		expect(f.get('music/romantic')!.fraction).toBeCloseTo(1 / 25)
		expect(f.get('music/classical')!.fraction).toBeCloseTo(1 / 25 / 2)
		// Jazz is a pillar with nothing under it: empty, not full for being unlocked.
		expect(f.get('music/jazz')!.fraction).toBe(0)
		expect(f.get('music/root')!.fraction).toBeCloseTo(1 / 25 / 2 / 2)
	})

	it('counts a list of its own as one more share beside the nodes under it', () => {
		const trees = { t: tree('t', [node('t/root', [], 'root'), node('t/a', ['t/root']), node('t/b', ['t/a'])]) }
		const f = fills(trees, { 't/a': { done: 1, total: 2 }, 't/b': { done: 0, total: 4 } })
		expect(f.get('t/a')!.fraction).toBeCloseTo((1 / 2 + 0) / 2)
		expect(f.get('t/a')!.below).toBe(1)
	})

	it('counts a hand tick as a share: empty until ticked, then full', () => {
		const trees = { t: tree('t', [node('t/root', [], 'root'), node('t/a', ['t/root']), node('t/b', ['t/root'])]) }
		expect(fills(trees, {}, { 't/a': ticked(false), 't/b': ticked(false) }).get('t/root')!.fraction).toBe(0)
		expect(fills(trees, {}, { 't/a': ticked(true), 't/b': ticked(false) }).get('t/root')!.fraction).toBe(0.5)
	})

	it("takes a tree hung on a pillar as one of the pillar's shares", () => {
		const trees = {
			mastery: tree('mastery', [node('mastery/root', [], 'mastery'), node('mastery/mental', ['mastery/root'], 'pillar'), node('mastery/physical', ['mastery/root'], 'pillar')]),
			music: tree('music', [node('music/root', [], 'root'), node('music/a', ['music/root'])], 'mastery/mental'),
		}
		const f = fills(trees, { 'music/a': { done: 1, total: 4 } })
		expect(f.get('mastery/mental')!.fraction).toBeCloseTo(1 / 4)
		expect(f.get('mastery/root')!.fraction).toBeCloseTo(1 / 4 / 2)
	})

	it("makes a path's steps shares of the node it starts from, not halves of the step before", () => {
		const path = tree('p', [
			node('p/root', [], 'root'),
			node('p/one', [], 'skill', { after: 'p/root' }),
			node('p/two', [], 'skill', { after: 'p/one' }),
			node('p/three', [], 'skill', { after: 'p/two' }),
		])
		expect(sharesOf(treeGraph({ p: path })).get('p/root')).toEqual(['p/one', 'p/two', 'p/three'])
		const f = fills({ p: path }, { 'p/one': { done: 0, total: 1 }, 'p/two': { done: 0, total: 1 }, 'p/three': { done: 1, total: 1 } })
		expect(f.get('p/root')!.fraction).toBeCloseTo(1 / 3)
		expect(f.get('p/one')!.below).toBe(0)
	})
})

describe('worksByNode', () => {
	it("counts an entry by its works, and doesn't count a work again for carrying its entry's tag", () => {
		const items: Record<string, TreeItem> = {
			romantic: { itemId: 'romantic', parent: '', children: ['r1', 'r2'], tags: ['music/romantic'] },
			r1: { itemId: 'r1', parent: 'romantic', children: [], tags: ['music/romantic'] },
			r2: { itemId: 'r2', parent: 'romantic', children: [], tags: ['music/romantic'] },
			single: { itemId: 'single', parent: '', children: [], tags: ['music/romantic'] },
		}
		const look = (itemId: string): TreeItemLook => ({ title: itemId, icon: null as never, done: itemId === 'single', draft: false, progress: itemId === 'romantic' ? { done: 1, total: 2 } : null })
		expect(worksByNode(items, look).get('music/romantic')).toEqual({ done: 2, total: 3 })
	})
})

describe('formatFill', () => {
	it('reads as a share, never 0% once something is done nor 100% before all of it is', () => {
		expect(formatFill(0)).toBe('0%')
		expect(formatFill(0.02375)).toBe('2.4%')
		expect(formatFill(0.0004)).toBe('<0.1%')
		expect(formatFill(0.4567)).toBe('46%')
		expect(formatFill(0.998)).toBe('99%')
		expect(formatFill(1)).toBe('100%')
	})
})
