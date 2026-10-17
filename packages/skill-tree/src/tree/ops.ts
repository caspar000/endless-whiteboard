import { connectShapes } from '@lifeboard/node-kit'
import { createShapeId, type Editor, type TLShapeId } from '@lifeboard/canvas'
import { isSkill, SKILL_TYPE, TREE_TYPE, treeNodes, type SkillShape } from '../board'
import { parseRequirements } from '../requirements'
import { SKILL_SIZE } from '../skill/definition'
import { radialTree } from './layout'

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
/** Where every node of a tree goes, by its layout: sectors and rings, or a radial lineage. */
export function treePositions(
	spec: { layout?: string; sectors: string[]; rings: string[]; nodes: readonly NewSkill[] },
	center: { x: number; y: number }
): Map<string, { x: number; y: number }> {
	const out = new Map<string, { x: number; y: number }>()
	if (spec.layout === 'lineage') {
		const parentOf = (node: NewSkill) => {
			const parsed = parseRequirements(node.requires ?? '')
			const first = parsed.ok ? parsed.conditions.find((c) => 'node' in c) : undefined
			return first && 'node' in first ? (first.node[0] ?? '') : ''
		}
		const placed = radialTree(spec.nodes.map((n) => ({ id: n.nodeId, parent: parentOf(n) })))
		for (const node of spec.nodes) {
			const p = placed.get(node.nodeId)
			if (!p) continue
			const radius = RING_GAP * p.depth
			out.set(node.nodeId, {
				x: center.x + radius * Math.cos(p.angle) - SKILL_SIZE / 2,
				y: center.y + radius * Math.sin(p.angle) - SKILL_SIZE / 2,
			})
		}
		return out
	}
	const cells = new Map<string, NewSkill[]>()
	for (const node of spec.nodes) {
		const key = `${node.sector ?? ''}|${node.ring ?? ''}`
		cells.set(key, [...(cells.get(key) ?? []), node])
	}
	for (const node of spec.nodes) {
		const ring = node.ring ? spec.rings.indexOf(node.ring) : -1
		const sector = Math.max(0, node.sector ? spec.sectors.indexOf(node.sector) : 0)
		const cell = cells.get(`${node.sector ?? ''}|${node.ring ?? ''}`) ?? [node]
		out.set(node.nodeId, sectorRingPosition(center, sector, spec.sectors.length, ring, cell.indexOf(node), cell.length))
	}
	return out
}

export function insertTree(
	editor: Editor,
	spec: { treeId: string; name: string; goal: string; sectors: string[]; rings: string[]; nodes: NewSkill[]; layout?: string },
	center: { x: number; y: number },
	/** Off when an outer `editor.run` already owns the undo entry. */
	mark = true
): TLShapeId {
	const headerId = createShapeId()
	editor.run(() => {
		if (mark) editor.markHistoryStoppingPoint('insert skill tree')
		const positions = treePositions(spec, center)
		const top = Math.min(center.y - SKILL_SIZE, ...[...positions.values()].map((p) => p.y))
		editor.createShape({
			id: headerId,
			type: TREE_TYPE,
			x: center.x - 140,
			y: top - 140,
			props: {
				treeId: spec.treeId,
				name: spec.name,
				goal: spec.goal,
				layout: spec.layout ?? 'sectors',
				sectors: spec.sectors.join(', '),
				rings: spec.rings.join(', '),
			},
		} as never)
		for (const node of spec.nodes) {
			const at = positions.get(node.nodeId) ?? center
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
