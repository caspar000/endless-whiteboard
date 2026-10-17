import { updateShapeProperties } from '@lifeboard/node-kit'
import { createShapeId, type Editor, type TLShapeId } from '@lifeboard/canvas'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { DRAFT_META, HABIT_TYPE, isDraft, isHabit, isSkill, isTree, SKILL_TYPE, TREE_TYPE } from './board'
import { parseTags, todayIso } from './model'
import { boardIdOf } from './skillIndex'
import { confirmDrafts, discardDrafts, getItems, getTracks, hasDrafts, putItems, putTracks, type ItemDef } from './syllabus'
import { mergeDoc } from './syllabusMerge'
import { drawMounts, drawPrerequisites, insertTree, layoutReach, placeNewNodes, treePositions } from './tree/ops'
import type { SyllabusDoc } from './syllabusYaml'
import { whileImporting } from './importing'
import { getTreeDef, updateTreeMeta } from './treeDefs'
import { boardTrees, DRAFT_TREE_META, draftTreeMeta, treeGraph } from './views'

/**
 * Putting a syllabus document into the vault and its tree on a board, and taking one out
 * (docs/skill-tree-plan.md, "The YAML format" and "Drafts").
 *
 * Items and tracks go into the vault (syllabusMerge.ts), with no shapes: the board gets the tree view
 * and the habit cards. "Show as list" and "Add Up Next" add the other views. An import is a
 * **draft**: what it makes is marked as this board's draft, draws dashed, and stays out of the index
 * until "Confirm draft". Ids that already exist are updated in place instead (titles, tags,
 * requirements; never a tick, a note or a habit's log), so a YAML file can be edited and imported again.
 */
export { DRAFT_META, isDraft } from './board'

export interface ImportResult {
	/** New items and tracks in the vault, and new shapes on the board. */
	created: number
	updated: number
	draftIds: TLShapeId[]
}

/** The board an import is a draft of: the one its editor shows. */
const boardOf = (editor: Editor) => boardIdOf(editor) ?? 'board'

export function importSyllabus(editor: Editor, doc: SyllabusDoc, at: { x: number; y: number }): ImportResult {
	return whileImporting(editor, () => importNow(editor, doc, at))
}

function importNow(editor: Editor, doc: SyllabusDoc, at: { x: number; y: number }): ImportResult {
	const before = new Set(editor.getCurrentPageShapeIds())
	let updated = 0
	let vaultCreated = 0
	editor.run(() => {
		editor.markHistoryStoppingPoint('import syllabus')
		let x = at.x

		const merged = mergeDoc(doc, getItems(), getTracks(), boardOf(editor))
		putItems(merged.items)
		putTracks(merged.tracks)
		vaultCreated = merged.created
		updated += merged.updated

		// A tree mounted on a node of another tree in this document shows inside that tree's view, so
		// it gets no header of its own.
		const inDoc = new Set(doc.trees.flatMap((t) => t.nodes.map((n) => n.nodeId)))
		const viewed: string[] = []
		// Trees already on the board that this import adds nodes to, and how many it adds.
		const grown: { treeId: string; fresh: string[]; had: number }[] = []
		// Trees this import puts on the board for the first time.
		const inserted: string[] = []
		for (const tree of doc.trees) {
			const nodes = tree.nodes.map((n) => ({ ...n }))
			const existing = new Map(
				editor
					.getCurrentPageShapes()
					.filter((s) => isSkill(s) && s.props.treeId === tree.treeId)
					.map((s) => [(s as { props: { nodeId: string } }).props.nodeId, s])
			)
			const header = editor.getCurrentPageShapes().find((s) => isTree(s) && s.props.treeId === tree.treeId)
			const fresh = nodes.filter((n) => !existing.has(n.nodeId))
			for (const node of nodes) {
				const shape = existing.get(node.nodeId)
				if (!shape) continue
				const { nodeId, ...props } = node
				void nodeId
				editor.updateShape({ id: shape.id, type: SKILL_TYPE, props } as never)
				updated++
			}
			// A tree the vault already has takes its new mount now, like any other merged field.
			if (tree.mount && getTreeDef(tree.treeId)) updateTreeMeta(tree.treeId, { mount: tree.mount })
			const mountedHere = !!tree.mount && inDoc.has(tree.mount)
			const ring = Math.max(1, tree.rings.length || 3)
			const center = { x: x + 230 * ring + 200, y: at.y + 230 * ring + 200 }
			if (!header && !mountedHere) {
				insertTree(editor, { ...tree, nodes: fresh }, center, false)
				inserted.push(tree.treeId)
			} else {
				if (header) {
					editor.updateShape({
						id: header.id,
						type: TREE_TYPE,
						props: { name: tree.name, goal: tree.goal, layout: tree.layout, sectors: tree.sectors.join(', '), rings: tree.rings.join(', ') },
					} as never)
					updated++
				}
				if (existing.size && fresh.length) grown.push({ treeId: tree.treeId, fresh: fresh.map((n) => n.nodeId), had: existing.size })
				const positions = treePositions({ ...tree, nodes: fresh }, center)
				for (const node of fresh) {
					const p = positions.get(node.nodeId) ?? center
					editor.createShape({ id: createShapeId(), type: SKILL_TYPE, parentId: editor.getCurrentPageId(), x: p.x, y: p.y, props: { ...node, treeId: tree.treeId } } as never)
				}
				drawPrerequisites(editor, tree.treeId)
			}
			if (mountedHere) continue
			viewed.push(tree.treeId)
			x = center.x + 230 * ring + 300
		}
		doc.habits.forEach((habit, i) => {
			const existing = editor.getCurrentPageShapes().find((s) => isHabit(s) && s.props.habitId === habit.habitId)
			if (existing) {
				const { habitId, state, ...props } = habit
				void habitId
				void state
				editor.updateShape({ id: existing.id, type: HABIT_TYPE, props: { ...props, goal: doc.name } } as never)
				updated++
				return
			}
			editor.createShape({
				id: createShapeId(),
				type: HABIT_TYPE,
				x,
				y: at.y + i * 110,
				props: { ...habit, goal: doc.name, startedAt: todayIso(), log: '{}' },
			} as never)
		})

		// Everything this import made, arrows included, is the draft; except an edge redrawn between two
		// nodes that were already there, which belongs to the confirmed tree.
		const made = editor
			.getCurrentPageShapes()
			.filter((s) => !before.has(s.id))
			.filter((s) => s.type !== 'arrow' || !editor.getBindingsFromShape(s, 'arrow').every((b) => before.has(b.toId)))
		const treeMeta = new Map(doc.trees.map((t) => [t.treeId, { name: t.name, goal: t.goal, mount: t.mount }]))
		for (const shape of made) {
			const carried = isSkill(shape) ? treeMeta.get(shape.props.treeId) : undefined
			editor.updateShape({ id: shape.id, type: shape.type, meta: { [DRAFT_META]: true, ...(carried ? { [DRAFT_TREE_META]: carried } : {}) } } as never)
		}

		// Placing after the marking above, because the layout reads draft nodes (and the mounts they
		// carry) from the board. A tree this import grew a lot is laid out again whole; a few new
		// nodes join their nearest ancestor and the rest stay where they are. Trees with others mounted
		// in this document are laid out whole, branches and all; the mount arrows are part of the draft.
		const mounted = doc.trees.some((t) => t.mount && inDoc.has(t.mount))
		if (mounted || grown.length || inserted.length) {
			const graph = treeGraph(boardTrees(editor))
			// New trees, and trees this import more than doubled, are laid out whole in the clear space
			// right of everything else: how wide a tree is is only known once it is laid out.
			const clear = new Set([...inserted, ...grown.filter((g) => g.fresh.length > g.had).map((g) => g.treeId)])
			const whole = new Set([...(mounted ? viewed : []), ...clear])
			for (const treeId of whole) {
				const root = graph.rootOf.get(treeId)
				if (root) layoutReach(editor, root, null, clear.has(treeId) ? 'clear' : undefined)
			}
			const few = grown.filter((g) => !whole.has(g.treeId)).flatMap((g) => g.fresh)
			if (few.length) placeNewNodes(editor, new Set(few))
			drawMounts(editor)
			for (const shape of editor.getCurrentPageShapes()) {
				if (!before.has(shape.id) && !isDraft(shape)) editor.updateShape({ id: shape.id, type: shape.type, meta: { [DRAFT_META]: true } } as never)
			}
		}
	})
	const draftIds = editor.getCurrentPageShapes().filter(isDraft).filter((s) => !before.has(s.id)).map((s) => s.id)
	return { created: draftIds.length + vaultCreated, updated, draftIds }
}

/** Takes the draft marker off everything on the board: it joins the index, and its trees the vault, from here on. */
export function confirmDraft(editor: Editor): number {
	return whileImporting(editor, () => confirmNow(editor))
}

function confirmNow(editor: Editor): number {
	const drafts = editor.getCurrentPageShapes().filter(isDraft)
	const vault = confirmDrafts(boardOf(editor))
	if (!drafts.length) return vault
	// A tree with no header of its own (mounted on another) carries its name and mount on its nodes.
	for (const shape of drafts) {
		if (!isSkill(shape)) continue
		const meta = draftTreeMeta(shape)
		if (Object.keys(meta).length) updateTreeMeta(shape.props.treeId, meta)
	}
	editor.run(() => {
		editor.markHistoryStoppingPoint('confirm draft')
		for (const shape of drafts) editor.updateShape({ id: shape.id, type: shape.type, meta: { [DRAFT_META]: false } } as never)
	})
	return drafts.length + vault
}

/** Deletes every draft shape on the board in one undo step, and what its imports put in the vault. */
export function discardDraft(editor: Editor): number {
	return whileImporting(editor, () => discardNow(editor))
}

function discardNow(editor: Editor): number {
	const drafts = editor.getCurrentPageShapes().filter(isDraft)
	const vault = discardDrafts(boardOf(editor))
	if (!drafts.length) return vault
	editor.run(() => {
		editor.markHistoryStoppingPoint('discard draft')
		editor.deleteShapes(drafts.map((s) => s.id))
	})
	return drafts.length + vault
}

/** Whether this board has a draft waiting: shapes, or vault items and tracks its imports made. */
export function boardHasDraft(editor: Editor): boolean {
	return hasDrafts(boardOf(editor)) || editor.getCurrentPageShapes().some(isDraft)
}

/** The goals there are syllabi for, by name: the vault's tracks, and this board's trees and habits. */
export function boardGoals(editor: Editor): string[] {
	const goals = [
		...Object.values(getTracks()).filter((t) => !t.draft).map((t) => t.goal),
		...editor
			.getCurrentPageShapes()
			.filter((s) => !isDraft(s))
			.flatMap((s) => (isTree(s) || isHabit(s) ? [s.props.goal] : [])),
	]
	return [...new Set(goals.filter(Boolean))]
}

/**
 * One goal's syllabus as YAML (the first goal if none is named): its tracks with their items, from
 * the vault, and this board's tree and habits for it. One goal per document, because an import gives everything in it the
 * document's goal. Ids are written in full, so importing the result again updates rather than
 * duplicates.
 */
export function exportSyllabus(editor: Editor, goalName?: string): string {
	const goal = goalName || boardGoals(editor)[0] || 'goal'
	const shapes = editor.getCurrentPageShapes().filter((s) => !isDraft(s))
	const ofGoal = (s: { props: { goal: string } }) => s.props.goal === goal || (!s.props.goal && !goalName)
	const tracks = Object.values(getTracks()).filter((t) => !t.draft && (t.goal === goal || (!t.goal && !goalName)))
	const trees = shapes.filter(isTree).filter(ofGoal)
	const prefix = (tracks[0]?.trackId || trees[0]?.props.treeId || '').split('/')[0]
	const all = getItems()
	const itemDoc = (item: ItemDef, depth = 0): Record<string, unknown> => {
		const children = item.children.map((id) => all[id]).filter((c): c is ItemDef => !!c && !c.draft)
		const out: Record<string, unknown> = { id: item.itemId, title: item.title }
		if (item.kind) out.kind = item.kind.toLowerCase()
		if (item.medium) out.medium = item.medium
		if (item.tags.length) out.tags = item.tags
		if (item.core) out.core = true
		if (children.length && depth < 16) {
			if (item.childRule !== 'core') out.childRule = item.childRule
			out.children = children.map((c) => itemDoc(c, depth + 1))
		}
		return out
	}
	const doc: Record<string, unknown> = { goal: prefix || goal.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: goal }
	if (tracks.length) {
		doc.tracks = tracks.map((t) => ({
			id: t.trackId,
			name: t.name,
			state: t.state,
			...(t.defaultTags.length ? { defaultTags: t.defaultTags } : {}),
			items: t.order.map((id) => {
				const item = all[id]
				return item && !item.draft ? itemDoc(item) : id
			}),
		}))
	}
	const tree = trees[0]
	if (tree) {
		// The vault's tree, whole: this board may show only a branch of it.
		const def = getTreeDef(tree.props.treeId)
		const nodes = def?.nodes ?? shapes.filter(isSkill).filter((s) => s.props.treeId === tree.props.treeId).map((s) => s.props)
		doc.tree = {
			id: tree.props.treeId,
			name: def?.name || tree.props.name,
			...(def?.mount ? { mount: def.mount } : {}),
			...(tree.props.sectors ? { sectors: parseTags(tree.props.sectors) } : {}),
			...(tree.props.rings ? { rings: parseTags(tree.props.rings) } : {}),
			nodes: nodes.map((n) => ({
				id: n.nodeId,
				name: n.name,
				kind: n.kind,
				...(n.icon ? { icon: n.icon } : {}),
				...(n.sector ? { sector: n.sector } : {}),
				...(n.ring ? { ring: n.ring } : {}),
				...(n.requires ? { requires: parseYaml(n.requires) as unknown } : {}),
			})),
		}
	}
	const habits = shapes.filter(isHabit).filter(ofGoal)
	if (habits.length) {
		doc.habits = habits.map((h) => ({
			id: h.props.habitId,
			name: h.props.name,
			period: h.props.period,
			target: h.props.target,
			...(h.props.counts ? { counts: parseYaml(h.props.counts) as unknown } : {}),
			...(h.props.startedBy ? { startedBy: h.props.startedBy } : {}),
		}))
	}
	return stringifyYaml(doc, { lineWidth: 0 })
}
