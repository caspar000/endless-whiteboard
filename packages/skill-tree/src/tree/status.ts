import type { Editor } from '@lifeboard/canvas'
import { isDraft, treeNodes } from '../board'
import { evaluateTree, type NodeStatus } from '../requirements'
import { getHabitIndex, getSkillIndex } from '../skillIndex'
import { getTreeDef } from '../treeDefs'

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
	return evaluateTree(nodes, getSkillIndex(), getHabitIndex())
}
