import type { Editor } from '@lifeboard/canvas'
import { AGGREGATE_KINDS } from '../board'
import { boardTrees, reachFrom, treeGraph } from '../views'
import { treeStatus } from './status'

/**
 * A node's branch: it and everything below it, across every tree mounted under it, whether or not
 * this board shows them. Mastery and the pillars are only their rings, so they aren't counted.
 * `done` once there is something and all of it is unlocked: a finished branch, drawn in gold.
 */
export function branchProgress(editor: Editor, nodeId: string): { trees: number; total: number; unlocked: number; done: boolean } {
	const graph = treeGraph(boardTrees(editor))
	const below = [...reachFrom(graph, nodeId)].filter((id) => !AGGREGATE_KINDS.includes(graph.nodes.get(id)!.def.kind))
	const trees = new Set(below.map((id) => graph.nodes.get(id)!.treeId))
	const statuses = new Map([...trees].flatMap((treeId) => [...treeStatus(editor, treeId)]))
	const unlocked = below.filter((id) => statuses.get(id)?.state === 'unlocked').length
	return { trees: trees.size, total: below.length, unlocked, done: below.length > 0 && unlocked === below.length }
}

/**
 * Whether a node is drawn gold: its branch is done, and it is more than a node on its own, or the
 * branch it sits in is done too. A skill with nothing below it stays blue once unlocked, like any
 * other, until the rest of its parent's branch is unlocked as well.
 */
export function inFinishedBranch(editor: Editor, nodeId: string): boolean {
	const own = branchProgress(editor, nodeId)
	if (!own.done) return false
	if (own.total > 1) return true
	const graph = treeGraph(boardTrees(editor))
	const parents = [...graph.prerequisites, ...graph.mounts, ...graph.loose].filter((e) => e.to === nodeId).map((e) => e.from)
	return parents.some((p) => branchProgress(editor, p).done)
}
