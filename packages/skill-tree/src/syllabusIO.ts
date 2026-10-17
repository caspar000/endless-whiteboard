import { updateShapeProperties } from '@lifeboard/node-kit'
import { createShapeId, type Editor, type TLShapeId } from '@lifeboard/canvas'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import {
	childrenOf,
	DRAFT_META,
	HABIT_TYPE,
	isDraft,
	isHabit,
	isItem,
	isSkill,
	isTrack,
	isTree,
	itemByItemId,
	SKILL_TYPE,
	TRACK_TYPE,
	TREE_TYPE,
	type ItemShape,
} from './board'
import { formatOrder, formatTags, parseOrder, parseTags, todayIso } from './model'
import { addChildItem, createItem, createTrack, ITEM_HEIGHT, setCollapsed } from './ops'
import { ensureProperties, hideOnCard, PROP_ID, readText } from './properties'
import { drawPrerequisites, insertTree, treePositions } from './tree/ops'
import type { DocItem, SyllabusDoc } from './syllabusYaml'
import { getTreeDef, updateTreeMeta } from './treeDefs'
import { draftTreeMeta } from './views'

/**
 * Putting a syllabus document on a board, and taking one off it (docs/skill-tree-plan.md, "The YAML
 * format" and "Drafts").
 *
 * An import is a **draft**: every shape it creates carries `lifeboard:skillDraft`, draws dashed, and
 * stays out of the index until "Confirm draft". Ids that already exist on the board are updated in
 * place instead (titles, tags, requirements; never a tick, a note or a habit's log), so a YAML file
 * can be edited and imported again.
 */
export { DRAFT_META, isDraft } from './board'

export interface ImportResult {
	created: number
	updated: number
	draftIds: TLShapeId[]
}

const COLUMN = 1100
const TRACK_TO_ITEMS = 420
const ROW_GAP = 24
const LIST_ROW = 24

export function importSyllabus(editor: Editor, doc: SyllabusDoc, at: { x: number; y: number }): ImportResult {
	const before = new Set(editor.getCurrentPageShapeIds())
	let updated = 0
	editor.run(() => {
		editor.markHistoryStoppingPoint('import syllabus')
		let x = at.x

		for (const track of doc.tracks) {
			const existingTrack = editor.getCurrentPageShapes().find((s) => isTrack(s) && s.props.trackId === track.trackId)
			let y = at.y
			for (const item of track.items) {
				const withDefaults = { ...item, tags: [...new Set([...item.tags, ...track.defaultTags])] }
				const existing = itemByItemId(editor, item.itemId)
				if (existing) {
					updated += mergeItem(editor, existing, withDefaults)
					continue
				}
				placeItem(editor, withDefaults, { x: x + TRACK_TO_ITEMS, y }, '')
				y += ITEM_HEIGHT + 16 + (item.children.length ? item.children.length * LIST_ROW : 0) + ROW_GAP
			}
			if (existingTrack && isTrack(existingTrack)) {
				const order = [...track.order, ...parseOrder(existingTrack.props.order).filter((id) => !track.order.includes(id))]
				editor.updateShape({
					id: existingTrack.id,
					type: TRACK_TYPE,
					props: { name: track.name, goal: doc.name, order: formatOrder(order), defaultTags: formatTags(track.defaultTags) },
				} as never)
				updated++
			} else {
				createTrack(
					editor,
					{ name: track.name, goal: doc.name, trackId: track.trackId, itemIds: track.order, state: track.state as 'active', defaultTags: formatTags(track.defaultTags) },
					{ x, y: at.y }
				)
			}
			x += COLUMN
		}

		if (doc.tree) {
			const tree = doc.tree
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
			const ring = Math.max(1, tree.rings.length || 3)
			const center = { x: x + 230 * ring + 200, y: at.y + 230 * ring + 200 }
			if (!header) {
				insertTree(editor, { ...tree, nodes: fresh }, center, false)
			} else {
				editor.updateShape({
					id: header.id,
					type: TREE_TYPE,
					props: { name: tree.name, goal: tree.goal, layout: tree.layout, sectors: tree.sectors.join(', '), rings: tree.rings.join(', ') },
				} as never)
				updated++
				const positions = treePositions({ ...tree, nodes: fresh }, center)
				for (const node of fresh) {
					const p = positions.get(node.nodeId) ?? center
					editor.createShape({ id: createShapeId(), type: SKILL_TYPE, x: p.x, y: p.y, props: { ...node, treeId: tree.treeId } } as never)
				}
				drawPrerequisites(editor, tree.treeId)
			}
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
		for (const shape of made) editor.updateShape({ id: shape.id, type: shape.type, meta: { [DRAFT_META]: true } } as never)
	})
	const draftIds = editor.getCurrentPageShapes().filter(isDraft).filter((s) => !before.has(s.id)).map((s) => s.id)
	return { created: draftIds.length, updated, draftIds }
}

function placeItem(editor: Editor, item: DocItem, at: { x: number; y: number }, parentId: TLShapeId | ''): TLShapeId {
	const spec = {
		itemId: item.itemId,
		title: item.title,
		kind: (item.kind || undefined) as 'Study' | undefined,
		medium: item.medium || undefined,
		tags: formatTags(item.tags),
		core: item.core,
		childRule: item.childRule,
	}
	const id = parentId ? addChildItem(editor, parentId, spec, false)! : createItem(editor, spec, at)
	for (const child of item.children) placeItem(editor, child, at, id)
	if (item.children.length) setCollapsed(editor, id, true, false)
	return id
}

/** Updates an existing item and its children from a document. Returns how many shapes changed. */
function mergeItem(editor: Editor, shape: ItemShape, item: DocItem): number {
	editor.updateShape({
		id: shape.id,
		type: shape.type,
		props: { title: item.title, tags: formatTags(item.tags), core: item.core, childRule: item.childRule },
	} as never)
	if (item.kind || item.medium) {
		ensureProperties(editor, ['kind', 'medium'])
		const fresh = editor.getShape(shape.id)
		if (fresh) {
			updateShapeProperties(editor, fresh, {
				...(item.kind ? { [PROP_ID.kind]: item.kind } : {}),
				...(item.medium ? { [PROP_ID.medium]: item.medium } : {}),
			})
			hideOnCard(editor, shape.id, ['kind', 'medium'])
		}
	}
	let changed = 1
	for (const child of item.children) {
		const existing = itemByItemId(editor, child.itemId)
		if (existing) changed += mergeItem(editor, existing, child)
		else placeItem(editor, child, { x: shape.x, y: shape.y }, shape.id)
	}
	return changed
}

/** Takes the draft marker off everything on the board: it joins the index, and its trees the vault, from here on. */
export function confirmDraft(editor: Editor): number {
	const drafts = editor.getCurrentPageShapes().filter(isDraft)
	if (!drafts.length) return 0
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
	return drafts.length
}

/** Deletes every draft shape on the board, in one undo step. */
export function discardDraft(editor: Editor): number {
	const drafts = editor.getCurrentPageShapes().filter(isDraft)
	if (!drafts.length) return 0
	editor.run(() => {
		editor.markHistoryStoppingPoint('discard draft')
		editor.deleteShapes(drafts.map((s) => s.id))
	})
	return drafts.length
}

/** The goals a board holds syllabi for, by name: from its tracks, trees and habits. */
export function boardGoals(editor: Editor): string[] {
	const goals = editor
		.getCurrentPageShapes()
		.filter((s) => !isDraft(s))
		.flatMap((s) => (isTrack(s) || isTree(s) || isHabit(s) ? [s.props.goal] : []))
	return [...new Set(goals.filter(Boolean))]
}

/**
 * One goal's syllabus on this board as YAML (the first goal if none is named): its tracks with their
 * items, its tree, its habits. One goal per document, because an import gives everything in it the
 * document's goal. Ids are written in full, so importing the result again updates rather than
 * duplicates.
 */
export function exportSyllabus(editor: Editor, goalName?: string): string {
	const goal = goalName || boardGoals(editor)[0] || 'goal'
	const shapes = editor.getCurrentPageShapes().filter((s) => !isDraft(s))
	const ofGoal = (s: { props: { goal: string } }) => s.props.goal === goal || (!s.props.goal && !goalName)
	const tracks = shapes.filter(isTrack).filter(ofGoal)
	const trees = shapes.filter(isTree).filter(ofGoal)
	const prefix = (tracks[0]?.props.trackId || trees[0]?.props.treeId || '').split('/')[0]
	const itemDoc = (item: ItemShape): Record<string, unknown> => {
		const children = childrenOf(editor, item.id)
		const out: Record<string, unknown> = { id: item.props.itemId, title: item.props.title }
		const kind = readText(item, 'kind')
		const medium = readText(item, 'medium')
		if (kind) out.kind = kind.toLowerCase()
		if (medium) out.medium = medium
		const tags = parseTags(item.props.tags)
		if (tags.length) out.tags = tags
		if (item.props.core) out.core = true
		if (children.length) {
			if (item.props.childRule !== 'core') out.childRule = item.props.childRule
			out.children = children.map(itemDoc)
		}
		return out
	}
	const doc: Record<string, unknown> = { goal: prefix || goal.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: goal }
	if (tracks.length) {
		doc.tracks = tracks.map((t) => ({
			id: t.props.trackId,
			name: t.props.name,
			state: t.props.state,
			...(parseTags(t.props.defaultTags).length ? { defaultTags: parseTags(t.props.defaultTags) } : {}),
			items: parseOrder(t.props.order).map((id) => {
				const item = itemByItemId(editor, id)
				return item && !isDraft(item) ? itemDoc(item) : id
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
