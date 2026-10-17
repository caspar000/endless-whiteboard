import type { Editor } from '@lifeboard/canvas'
import { treeNodes } from '../board'
import { evaluateTree, type NodeStatus } from '../requirements'
import { getHabitIndex, getSkillIndex } from '../skillIndex'

/**
 * Every node of a tree, evaluated against the index. Read inside a `useValue`, so a node redraws
 * when the index or any node of its tree changes. A tree is tens of nodes, so evaluating it whole
 * per read is cheaper than keeping a dependency graph of conditions in sync.
 */
export function treeStatus(editor: Editor, treeId: string): Map<string, NodeStatus> {
	const nodes = treeNodes(editor, treeId).map((n) => ({
		nodeId: n.props.nodeId,
		name: n.props.name,
		requires: n.props.requires,
		kind: n.props.kind,
	}))
	return evaluateTree(nodes, getSkillIndex(), getHabitIndex())
}
