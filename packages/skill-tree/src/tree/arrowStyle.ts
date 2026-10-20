import type { Editor, TLArrowBinding, TLShape, TLShapeId } from '@lifeboard/canvas'
import { AGGREGATE_KINDS, isSkill, type SkillShape } from '../board'
import type { NodeStatus } from '../requirements'
import { SKILL_EDGE_META } from './ops'
import { branchProgress } from './branch'
import { treeStatus } from './status'
import { LINE, sendLinesBack } from './viewSync'

/**
 * How a line between skill nodes (an arrow on the canvas, drawn without heads, from centre to centre
 * under the discs) shows the way travelled:
 *
 * - **Ahead** (the node it leads to still locked or only in reach): grey, like the cards' lines. Not
 *   dotted: lines leaving a shared corridor cell part cleanly only when solid (their dots fall apart).
 * - **Unlocked** (that node unlocked): solid, in the accent colour, like the node's own ring.
 * - **A whole branch unlocked** (the node it leaves and everything below that node, tree/branch.ts):
 *   solid gold, like the branch's nodes, so a finished part of the tree stands out.
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
	const updates: { id: TLShapeId; type: 'arrow'; props: Look }[] = []
	const anchored: TLArrowBinding[] = []
	for (const { arrow, from, to } of edges) {
		const look = branch(from).done ? GOLD : unlocked(to) ? ACCENT : AHEAD
		const props = arrow.props as Partial<Look>
		if ((Object.keys(look) as (keyof Look)[]).some((k) => props[k] !== look[k])) updates.push({ id: arrow.id, type: 'arrow', props: look })
		// Each end runs to the middle of its node, under the disc, as a card's line does.
		for (const b of editor.getBindingsFromShape<TLArrowBinding>(arrow, 'arrow')) {
			const now = b.props.normalizedAnchor
			if (!b.props.isExact || !b.props.isPrecise || now.x !== 0.5 || now.y !== 0.5) anchored.push({ ...b, props: { ...b.props, normalizedAnchor: { x: 0.5, y: 0.5 }, isPrecise: true, isExact: true } })
		}
	}
	editor.run(
		() => {
			if (updates.length) editor.updateShapes(updates as never)
			if (anchored.length) editor.updateBindings(anchored)
			// Thickest, then the way travelled, on top; only restacked when that isn't so already.
			sendLinesBack(editor)
		},
		{ history: 'ignore' }
	)
}

/** A line between skill nodes: the thickest on the tree, with no arrowheads (cards' lines thin out below it, viewSync.ts). */
type Look = { dash: string; color: string; size: string; arrowheadStart: string; arrowheadEnd: string }
const LINE_LOOK = { size: 'l', arrowheadStart: 'none', arrowheadEnd: 'none' }
const AHEAD: Look = { ...LINE_LOOK, dash: 'solid', color: 'grey' }
const ACCENT: Look = { ...LINE_LOOK, dash: 'solid', color: 'blue' }
const GOLD: Look = { ...LINE_LOOK, dash: 'solid', color: 'yellow' }
