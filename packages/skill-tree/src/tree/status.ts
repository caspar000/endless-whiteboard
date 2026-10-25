import type { Editor } from '@lifeboard/canvas'
import { isDraft, treeNodes } from '../board'
import { evaluateTree, type NodeStatus } from '../requirements'
import { getSkillIndex } from '../skillIndex'
import { getTreeDef, getTreeDefs } from '../treeDefs'

/**
 * Every node of a tree, evaluated against the index. Read inside a `useValue`, so a node redraws
 * when the index or its tree changes. A tree is tens of nodes, so evaluating it whole per read is
 * cheaper than keeping a dependency graph of conditions in sync.
 *
 * The tree is the vault's definition (treeDefs.ts), so a board showing one branch still evaluates
 * against the whole tree; draft nodes on this board, which the vault hasn't got yet, are added to it.
 * A tree the vault has never seen is read from this board's shapes.
 */
export function treeStatus(editor: Editor, treeId: string): Map<string, NodeStatus> {
	const def = getTreeDef(treeId)
	const shapes = treeNodes(editor, treeId)
	const fromShapes = (def ? shapes.filter(isDraft) : shapes).map((n) => ({
		nodeId: n.props.nodeId,
		name: n.props.name,
		requires: n.props.requires,
		kind: n.props.kind,
	}))
	const known = new Set(def?.nodes.map((n) => n.nodeId))
	const nodes = [...(def?.nodes ?? []), ...fromShapes.filter((n) => !known.has(n.nodeId))]
	// A node shared with another tree asks that tree for the state of what it requires there. Two
	// trees requiring each other's nodes stop at the first one asked again: that node counts as locked.
	evaluating.add(treeId)
	try {
		return evaluateTree(nodes, getSkillIndex(), (nodeId) => {
			const other = Object.values(getTreeDefs()).find((t) => t.nodes.some((n) => n.nodeId === nodeId))
			return other && !evaluating.has(other.treeId) ? treeStatus(editor, other.treeId).get(nodeId) : undefined
		})
	} finally {
		evaluating.delete(treeId)
	}
}

const evaluating = new Set<string>()
