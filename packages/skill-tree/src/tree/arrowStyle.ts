import type { Editor, TLArrowBinding, TLShape, TLShapeId } from '@lifeboard/canvas'
import { AGGREGATE_KINDS, isSkill, type SkillShape } from '../board'
import type { NodeStatus } from '../requirements'
import { SKILL_EDGE_META } from './ops'
import { treeStatus } from './status'
import { LINE } from './viewSync'

/**
 * How an arrow between skill nodes shows the way travelled:
 *
 * - **Ahead** (the node it points at still locked or only in reach): dotted, in the ordinary colour.
 * - **Unlocked** (that node unlocked): solid, in the accent colour, like the node's own ring.
 * - **A whole branch unlocked** (the node it leaves and everything below that node): solid gold, and
 *   thicker, so a finished part of the tree stands out from one under way.
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
	// The arrows as a graph: each skill node's children.
	const edges: { arrow: TLShape; from: SkillShape; to: SkillShape }[] = []
	const below = new Map<TLShapeId, SkillShape[]>()
	for (const arrow of editor.getCurrentPageShapes()) {
		if (arrow.type !== 'arrow' || !arrow.meta[SKILL_EDGE_META] || arrow.meta[SKILL_EDGE_META] === LINE) continue
		const bindings = editor.getBindingsFromShape<TLArrowBinding>(arrow, 'arrow')
		const end = (terminal: 'start' | 'end') => editor.getShape(bindings.find((b) => b.props.terminal === terminal)?.toId ?? ('' as TLShapeId))
		const [from, to] = [end('start'), end('end')]
		if (!isSkill(from) || !isSkill(to)) continue
		edges.push({ arrow, from, to })
		below.set(from.id, [...(below.get(from.id) ?? []), to])
	}
	const aggregate = (s: SkillShape) => AGGREGATE_KINDS.includes(s.props.kind)
	const unlockedSelf = (s: SkillShape) => stateOf(s.props.treeId, s.props.nodeId) === 'unlocked'
	// Whether a node and everything below it is unlocked, and whether anything at or below it is.
	const whole = new Map<TLShapeId, boolean>()
	const any = new Map<TLShapeId, boolean>()
	const walk = (s: SkillShape) => {
		if (whole.has(s.id)) return
		// Provisional, so a loop of arrows ends here.
		whole.set(s.id, true)
		any.set(s.id, false)
		const kids = below.get(s.id) ?? []
		for (const k of kids) walk(k)
		const self = aggregate(s) ? kids.length > 0 : unlockedSelf(s)
		whole.set(s.id, self && kids.every((k) => whole.get(k.id)))
		any.set(s.id, (!aggregate(s) && self) || kids.some((k) => any.get(k.id)))
	}
	const updates: { id: TLShapeId; type: 'arrow'; props: { dash: string; color: string; size: string } }[] = []
	for (const { arrow, from, to } of edges) {
		walk(from)
		const look = whole.get(from.id) ? GOLD : (aggregate(to) ? any.get(to.id) : unlockedSelf(to)) ? ACCENT : AHEAD
		const props = arrow.props as { dash?: string; color?: string; size?: string }
		if (props.dash !== look.dash || props.color !== look.color || props.size !== look.size) updates.push({ id: arrow.id, type: 'arrow', props: look })
	}
	if (updates.length) editor.run(() => editor.updateShapes(updates as never), { history: 'ignore' })
}

const AHEAD = { dash: 'dotted', color: 'black', size: 'm' }
const ACCENT = { dash: 'solid', color: 'blue', size: 'm' }
const GOLD = { dash: 'solid', color: 'yellow', size: 'l' }
