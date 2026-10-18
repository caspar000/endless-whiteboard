import type { Editor, TLArrowBinding, TLShapeId } from '@lifeboard/canvas'
import { AGGREGATE_KINDS, isSkill } from '../board'
import type { NodeStatus } from '../requirements'
import { SKILL_EDGE_META } from './ops'
import { treeStatus } from './status'
import { LINE } from './viewSync'

/**
 * An arrow between skill nodes is drawn solid once the node it points at is unlocked, dotted while
 * that node is still locked or only in reach: the way on is shown, the way travelled stands out.
 * Mastery and the pillars count as unlocked, as their ring is everything below them.
 */
export function styleArrows(editor: Editor): void {
	const statuses = new Map<string, Map<string, NodeStatus>>()
	const stateOf = (treeId: string, nodeId: string) => {
		let tree = statuses.get(treeId)
		if (!tree) statuses.set(treeId, (tree = treeStatus(editor, treeId)))
		return tree.get(nodeId)?.state ?? 'locked'
	}
	const updates: { id: TLShapeId; type: 'arrow'; props: { dash: string } }[] = []
	for (const arrow of editor.getCurrentPageShapes()) {
		if (arrow.type !== 'arrow' || !arrow.meta[SKILL_EDGE_META] || arrow.meta[SKILL_EDGE_META] === LINE) continue
		const end = editor.getBindingsFromShape<TLArrowBinding>(arrow, 'arrow').find((b) => b.props.terminal === 'end')
		const target = end && editor.getShape(end.toId)
		if (!isSkill(target)) continue
		const unlocked = AGGREGATE_KINDS.includes(target.props.kind) || stateOf(target.props.treeId, target.props.nodeId) === 'unlocked'
		const dash = unlocked ? 'solid' : 'dotted'
		if ((arrow.props as { dash?: string }).dash !== dash) updates.push({ id: arrow.id, type: 'arrow', props: { dash } })
	}
	if (updates.length) editor.run(() => editor.updateShapes(updates as never), { history: 'ignore' })
}
