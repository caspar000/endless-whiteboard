import { connectShapes } from '@lifeboard/node-kit'
import { createShapeId, type Editor, type TLShapeId } from '@lifeboard/canvas'
import { isSkill, SKILL_TYPE, TREE_TYPE, treeNodes, type SkillShape } from '../board'
import { parseRequirements } from '../requirements'
import { SKILL_SIZE } from '../skill/definition'

/** Meta on the arrows this extension draws between prerequisites, so redrawing can find its own. */
export const SKILL_EDGE_META = 'lifeboard:skillEdge'

const RING_GAP = 230

/**
 * Where a node sits on a sectors-and-rings tree: the root at the centre, rings outward, sectors as
 * wedges, nodes sharing a cell spread along their arc. Returned as the node's top-left corner.
 */
export function sectorRingPosition(
	center: { x: number; y: number },
	sector: number,
	sectors: number,
	ring: number,
	slot = 0,
	slots = 1
): { x: number; y: number } {
	if (ring < 0) return { x: center.x - SKILL_SIZE / 2, y: center.y - SKILL_SIZE / 2 }
	const wedge = (2 * Math.PI) / Math.max(1, sectors)
	const angle = -Math.PI / 2 + wedge * sector + (wedge * (slot + 1)) / (slots + 1) - wedge / 2
	const radius = RING_GAP * (ring + 1)
	return {
		x: center.x + radius * Math.cos(angle) - SKILL_SIZE / 2,
		y: center.y + radius * Math.sin(angle) - SKILL_SIZE / 2,
	}
}

export interface NewSkill {
	nodeId: string
	name: string
	kind?: string
	sector?: string
	ring?: string
	requires?: string
	icon?: string
}

/**
 * Places a whole tree: its header above, and each node at its sector and ring (an empty ring is the
 * root at the centre). One undo entry; positions are written once and are yours to move afterwards.
 */
export function insertTree(
	editor: Editor,
	spec: { treeId: string; name: string; goal: string; sectors: string[]; rings: string[]; nodes: NewSkill[] },
	center: { x: number; y: number }
): TLShapeId {
	const headerId = createShapeId()
	editor.run(() => {
		editor.markHistoryStoppingPoint('insert skill tree')
		const outer = RING_GAP * spec.rings.length + SKILL_SIZE
		editor.createShape({
			id: headerId,
			type: TREE_TYPE,
			x: center.x - 140,
			y: center.y - outer - 120,
			props: { treeId: spec.treeId, name: spec.name, goal: spec.goal, layout: 'sectors', sectors: spec.sectors.join(', '), rings: spec.rings.join(', ') },
		} as never)
		const cells = new Map<string, NewSkill[]>()
		for (const node of spec.nodes) {
			const key = `${node.sector ?? ''}|${node.ring ?? ''}`
			cells.set(key, [...(cells.get(key) ?? []), node])
		}
		for (const node of spec.nodes) {
			const ring = node.ring ? spec.rings.indexOf(node.ring) : -1
			const sector = Math.max(0, node.sector ? spec.sectors.indexOf(node.sector) : 0)
			const cell = cells.get(`${node.sector ?? ''}|${node.ring ?? ''}`) ?? [node]
			const at = sectorRingPosition(center, sector, spec.sectors.length, ring, cell.indexOf(node), cell.length)
			editor.createShape({
				id: createShapeId(),
				type: SKILL_TYPE,
				x: at.x,
				y: at.y,
				props: {
					nodeId: node.nodeId,
					treeId: spec.treeId,
					name: node.name,
					kind: node.kind ?? 'skill',
					sector: node.sector ?? '',
					ring: node.ring ?? '',
					requires: node.requires ?? '',
					icon: node.icon ?? '',
				},
			} as never)
		}
		drawPrerequisites(editor, spec.treeId)
	})
	return headerId
}

/**
 * Draws one arrow per prerequisite of every node in a tree, replacing the ones drawn before. The
 * arrows are a picture of the requirements, never read back: what a node requires lives in its
 * `requires` alone, so tidying or deleting a line changes nothing about the tree.
 */
export function drawPrerequisites(editor: Editor, treeId: string): void {
	const nodes = treeNodes(editor, treeId)
	const byNodeId = new Map(nodes.map((n) => [n.props.nodeId, n]))
	const ours = new Set(nodes.map((n) => n.id as string))
	const stale = editor
		.getCurrentPageShapes()
		.filter((s) => s.type === 'arrow' && s.meta[SKILL_EDGE_META] === treeId)
		.map((s) => s.id)
	editor.run(() => {
		if (stale.length) editor.deleteShapes(stale)
		for (const node of nodes) {
			const parsed = parseRequirements(node.props.requires)
			if (!parsed.ok) continue
			for (const condition of parsed.conditions) {
				if (!('node' in condition)) continue
				for (const id of condition.node) {
					const from = byNodeId.get(id)
					if (!from || !ours.has(from.id)) continue
					const arrow = connectShapes(editor, from.id, node.id)
					if (arrow) editor.updateShape({ id: arrow, type: 'arrow', meta: { [SKILL_EDGE_META]: treeId } })
				}
			}
		}
	})
}

/** The tree a selection is about: a selected node's or header's. */
export function selectedTreeId(editor: Editor): string | null {
	for (const shape of editor.getSelectedShapes()) {
		if (isSkill(shape)) return (shape as SkillShape).props.treeId
		if (shape.type === TREE_TYPE) return (shape.props as { treeId: string }).treeId
	}
	return null
}
