import type { Editor, TLArrowBinding, TLShape, TLShapeId } from '@lifeboard/canvas'
import { AGGREGATE_KINDS, isSkill, type SkillShape } from '../board'
import type { NodeStatus } from '../requirements'
import { SKILL_EDGE_META } from './ops'
import { branchProgress } from './branch'
import { treeStatus } from './status'
import { LINE } from './viewSync'

/**
 * How an arrow between skill nodes shows the way travelled:
 *
 * - **Ahead** (the node it points at still locked or only in reach): dotted, in the ordinary colour.
 * - **Unlocked** (that node unlocked): solid, in the accent colour, like the node's own ring.
 * - **A whole branch unlocked** (the node it leaves and everything below that node, tree/branch.ts):
 *   solid gold, and thicker, like the branch's nodes, so a finished part of the tree stands out.
 *
 * Mastery and the pillars are only their rings: one counts as unlocked once anything below it is,
 * and its branch as whole once everything below it is.
 */
export function styleArrows(editor: Editor): void {
	const statuses = new Map<string, Map<string, NodeStatus>>()
	const stateOf = (treeId: string, nodeId: string) => {
		let tree = statuses.get(treeId)
		if (!tree) statuses.set(treeId, (tree = treeStatus(editor, treeId)))
		return tree.get(nodeId)?.state ?? 'locked'
	}
	const edges: { arrow: TLShape; from: SkillShape; to: SkillShape }[] = []
	for (const arrow of editor.getCurrentPageShapes()) {
		if (arrow.type !== 'arrow' || !arrow.meta[SKILL_EDGE_META] || arrow.meta[SKILL_EDGE_META] === LINE) continue
		const bindings = editor.getBindingsFromShape<TLArrowBinding>(arrow, 'arrow')
		const end = (terminal: 'start' | 'end') => editor.getShape(bindings.find((b) => b.props.terminal === terminal)?.toId ?? ('' as TLShapeId))
		const [from, to] = [end('start'), end('end')]
		if (!isSkill(from) || !isSkill(to)) continue
		edges.push({ arrow, from, to })
	}
	const aggregate = (s: SkillShape) => AGGREGATE_KINDS.includes(s.props.kind)
	const branches = new Map<string, ReturnType<typeof branchProgress>>()
	const branch = (s: SkillShape) => {
		let b = branches.get(s.props.nodeId)
		if (!b) branches.set(s.props.nodeId, (b = branchProgress(editor, s.props.nodeId)))
		return b
	}
	const unlocked = (s: SkillShape) => (aggregate(s) ? branch(s).unlocked > 0 : stateOf(s.props.treeId, s.props.nodeId) === 'unlocked')
	const updates: { id: TLShapeId; type: 'arrow'; props: { dash: string; color: string; size: string } }[] = []
	for (const { arrow, from, to } of edges) {
		const look = branch(from).done ? GOLD : unlocked(to) ? ACCENT : AHEAD
		const props = arrow.props as { dash?: string; color?: string; size?: string }
		if (props.dash !== look.dash || props.color !== look.color || props.size !== look.size) updates.push({ id: arrow.id, type: 'arrow', props: look })
	}
	if (updates.length) editor.run(() => editor.updateShapes(updates as never), { history: 'ignore' })
}

const AHEAD = { dash: 'dotted', color: 'black', size: 'm' }
const ACCENT = { dash: 'solid', color: 'blue', size: 'm' }
const GOLD = { dash: 'solid', color: 'yellow', size: 'l' }
