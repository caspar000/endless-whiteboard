import { computed, type Computed, type Editor } from '@lifeboard/canvas'
import { AGGREGATE_KINDS } from '../board'
import { conditionFraction, type NodeStatus } from '../requirements'
import { allItems, lookOf, type TreeItem, type TreeItemLook } from '../sources'
import { boardTrees, treeGraph, type TreeGraph } from '../views'
import { prerequisitesOf } from './prerequisites'
import { treeStatus } from './status'

/**
 * How full a node's ring is (DARK-15): how much of everything it stands for is done, at any depth.
 *
 * - A node with a list of its own (a syllabus entry tagged to it, with its works) fills by the part
 *   of that list done: Romantic, 1 album of 25, is 1/25 full. Not by how close it is to unlocking,
 *   which its requirements decide (any 5 of the 25).
 * - Every node that grows from a node, and every tree hung on it, is an equal share of it. Western
 *   Classical's 8 genres are 1/8 of it each, so 1 Romantic album makes it 1/8 × 1/25 full. Its own
 *   list, or its own conditions (a hand tick), is one more share.
 * - A path (`after`, made from a syllabus) is a row of steps, not a branch that deepens: each step
 *   is a share of the node the path starts from, rather than half of the step before it.
 * - A node with nothing to do of its own and nothing below it is full once unlocked. You and a
 *   pillar are only what is below them, so with nothing below they are empty.
 */

export interface Works {
	done: number
	total: number
}

export interface NodeFill {
	/** 0 to 1. */
	fraction: number
	/** The works of the node's own list, done of all, or null without one. */
	works: Works | null
	/** Shares below it: nodes growing from it and trees hung on it. */
	below: number
}

/** The works of every node's own list: the source items tagged to it, each item's works, or itself without any. */
export function worksByNode(items: Readonly<Record<string, TreeItem>>, look: (itemId: string) => TreeItemLook | null): Map<string, Works> {
	const out = new Map<string, Works>()
	for (const item of Object.values(items)) {
		const parent = item.parent ? items[item.parent] : undefined
		for (const tag of item.tags) {
			// A work carries its entry's tags: it is counted in its entry's progress, not again.
			if (parent?.tags.includes(tag)) continue
			const seen = look(item.itemId)
			if (!seen) continue
			const works = seen.progress ?? { done: seen.done ? 1 : 0, total: 1 }
			const had = out.get(tag)
			out.set(tag, { done: (had?.done ?? 0) + works.done, total: (had?.total ?? 0) + works.total })
		}
	}
	return out
}

/** Each node's shares: what grows from it and the trees hung on it, a path's steps on the node it starts from. */
export function sharesOf(graph: TreeGraph): Map<string, string[]> {
	// A node on a path only follows the step before it (`after`), it doesn't require it.
	const step = (id: string) => {
		const def = graph.nodes.get(id)?.def
		return def?.after && graph.nodes.has(def.after) && !prerequisitesOf(def.requires).includes(def.after) ? def.after : ''
	}
	const pathStart = (id: string) => {
		const seen = new Set<string>()
		for (let at = id; ; at = step(at)) {
			if (!step(at) || seen.has(at)) return at
			seen.add(at)
		}
	}
	const out = new Map<string, Set<string>>()
	const add = (from: string, to: string) => {
		if (from === to) return
		const set = out.get(from)
		if (set) set.add(to)
		else out.set(from, new Set([to]))
	}
	for (const { from, to } of graph.prerequisites) add(step(to) === from ? pathStart(from) : from, to)
	for (const { from, to } of [...graph.mounts, ...graph.loose]) add(from, to)
	return new Map([...out].map(([id, set]) => [id, [...set]]))
}

/** Every node's fill. Pure: the graph, each node's own works and its status in. */
export function fillsOf(graph: TreeGraph, works: ReadonlyMap<string, Works>, statusOf: (nodeId: string) => NodeStatus | undefined): Map<string, NodeFill> {
	const shares = sharesOf(graph)
	const out = new Map<string, NodeFill>()
	const visiting = new Set<string>()

	const fill = (nodeId: string): NodeFill => {
		const known = out.get(nodeId)
		if (known) return known
		// A node below itself adds nothing the second time round.
		if (visiting.has(nodeId)) return { fraction: 0, works: null, below: 0 }
		visiting.add(nodeId)
		const below = (shares.get(nodeId) ?? []).map((id) => fill(id).fraction)
		visiting.delete(nodeId)
		const own = works.get(nodeId) ?? null
		const status = statusOf(nodeId)
		const parts = [...below]
		if (own) parts.unshift(own.total ? own.done / own.total : 0)
		else if (status?.conditions.some((c) => !c.prerequisite)) parts.unshift(conditionsFill(status))
		const aggregate = AGGREGATE_KINDS.includes(graph.nodes.get(nodeId)?.def.kind ?? '')
		const fraction = parts.length ? parts.reduce((sum, p) => sum + p, 0) / parts.length : !aggregate && status?.state === 'unlocked' ? 1 : 0
		const result = { fraction, works: own, below: below.length }
		out.set(nodeId, result)
		return result
	}

	for (const nodeId of graph.nodes.keys()) fill(nodeId)
	return out
}

/** A node's own conditions as a share: full once unlocked, none while locked. */
const conditionsFill = (status: NodeStatus) => (status.state === 'unlocked' ? 1 : status.state === 'locked' ? 0 : conditionFraction(status))

const byBoard = new WeakMap<Editor, Computed<Map<string, NodeFill>>>()

/** A node's fill on `editor`'s board. Worked out once for every node, and again when anything it reads changes. */
export function nodeFill(editor: Editor, nodeId: string): NodeFill | null {
	let fills = byBoard.get(editor)
	if (!fills) {
		fills = computed('lifeboard:skill-fills', () => {
			const graph = treeGraph(boardTrees(editor))
			const trees = new Map<string, Map<string, NodeStatus>>()
			const statusOf = (id: string) => {
				const treeId = graph.nodes.get(id)?.treeId
				if (!treeId) return undefined
				let statuses = trees.get(treeId)
				if (!statuses) trees.set(treeId, (statuses = treeStatus(editor, treeId)))
				return statuses.get(id)
			}
			return fillsOf(graph, worksByNode(allItems(), lookOf), statusOf)
		})
		byBoard.set(editor, fills)
	}
	return fills.get().get(nodeId) ?? null
}

/** A fill as a caption: `2.4%`, never 100% before it is all done nor 0% once something is. */
export function formatFill(fraction: number): string {
	const percent = fraction * 100
	if (percent <= 0) return '0%'
	if (percent >= 100) return '100%'
	if (percent < 0.1) return '<0.1%'
	if (percent < 10) return `${Math.round(percent * 10) / 10}%`
	return `${Math.min(99, Math.round(percent))}%`
}
