import type { Editor, TLShape, TLShapeId } from '@lifeboard/canvas'
import { childProgress, parseChildRule, type ChildProgress } from './model'
import { isDone, readText } from './properties'

/**
 * Reading the syllabus off the board you are on. Step 1 keeps everything on one board; the
 * cross-board index of step 2 replaces these lookups for anything that has to see further.
 */

export const ITEM_TYPE = 'node.skillItem'
export const TRACK_TYPE = 'node.track'
export const NOTE_TYPE = 'node.markdown'

export interface SkillItemProps {
	/** Stable across boards, renames and re-imports (docs/skill-tree-plan.md, "Items"). */
	itemId: string
	title: string
	/** The parent item's shape id, or '' at the top level. */
	parentId: string
	/** This child is one its parent's `core` rule waits for. */
	core: boolean
	/** `core` | `all` | `n:3`; only read when the item has children. */
	childRule: string
	/** Hide the children and show them as a checklist on this card. */
	collapsed: boolean
	/** Node ids this item feeds, comma-separated. Read by the trees of step 2. */
	tags: string
	autoHeight: boolean
}

export interface TrackProps {
	trackId: string
	name: string
	goal: string
	/** `active` | `paused` | `notStarted` */
	state: string
	/** Item ids in order, newline-separated. The track owns the order. */
	order: string
	/** Tags every item in the track inherits. */
	defaultTags: string
	autoHeight: boolean
}

export type ItemShape = TLShape & { type: typeof ITEM_TYPE; props: SkillItemProps }
export type TrackShape = TLShape & { type: typeof TRACK_TYPE; props: TrackProps }

export function isItem(shape: TLShape | undefined | null): shape is ItemShape {
	return shape?.type === ITEM_TYPE
}

export function isTrack(shape: TLShape | undefined | null): shape is TrackShape {
	return shape?.type === TRACK_TYPE
}

export function pageItems(editor: Editor): ItemShape[] {
	return editor.getCurrentPageShapes().filter(isItem)
}

/** Children in reading order: top to bottom, then left to right. */
export function childrenOf(editor: Editor, parentId: TLShapeId): ItemShape[] {
	return pageItems(editor)
		.filter((item) => item.props.parentId === parentId)
		.sort((a, b) => a.y - b.y || a.x - b.x)
}

export function progressOf(editor: Editor, parent: ItemShape): ChildProgress {
	const children = childrenOf(editor, parent.id)
	return childProgress(
		children.map((child) => ({ done: isDone(child), core: child.props.core })),
		parseChildRule(parent.props.childRule)
	)
}

/** The item with this global id on this board, if it is here. */
export function itemByItemId(editor: Editor, itemId: string): ItemShape | undefined {
	return pageItems(editor).find((item) => item.props.itemId === itemId)
}

/** The note filed as this item's evidence, if there is one on this board. */
export function evidenceNoteFor(editor: Editor, itemId: string): TLShape | undefined {
	if (!itemId) return undefined
	return editor
		.getCurrentPageShapes()
		// `node.markdown` is the notes package's type; this package doesn't import its shape types.
		.find((shape) => (shape.type as string) === NOTE_TYPE && readText(shape, 'evidenceOf') === itemId)
}

/**
 * Whether this item is hidden: an ancestor is collapsed, or an ancestor is gone.
 *
 * A deleted parent hides its children rather than taking them with it. Deleting them from a delete
 * side effect would be quicker, but this canvas's undo replays only what the delete command itself
 * captured, so one ⌘Z would bring the parent back without its children. Hidden, they come back with
 * it; orphans left over are swept when the board next opens (`sweepOrphans`).
 */
export function isHiddenByCollapse(editor: Editor, item: ItemShape): boolean {
	let parentId = item.props.parentId
	// Bounded, so a cycle someone made by hand can't hang the visibility cache.
	for (let depth = 0; parentId && depth < 16; depth++) {
		const parent = editor.getShape(parentId as TLShapeId)
		if (!isItem(parent)) return true
		if (parent.props.collapsed) return true
		parentId = parent.props.parentId
	}
	return false
}

/** Whether an ancestor of this item has been deleted. */
export function isOrphan(editor: Editor, item: ItemShape): boolean {
	let parentId = item.props.parentId
	for (let depth = 0; parentId && depth < 16; depth++) {
		const parent = editor.getShape(parentId as TLShapeId)
		if (!isItem(parent)) return true
		parentId = parent.props.parentId
	}
	return false
}

export const SKILL_TYPE = 'node.skill'
export const TREE_TYPE = 'node.skillTree'

export interface SkillNodeProps {
	/** Namespaced by goal (`adler/greek-drama`); what item tags and `node` conditions name. */
	nodeId: string
	/** The tree this node belongs to; a board can hold several. */
	treeId: string
	name: string
	/** `root` | `skill` | `method` | `keystone` */
	kind: string
	sector: string
	ring: string
	/** The requirement list, as YAML (see requirements.ts). */
	requires: string
	/** A board-icon name (Tabler), drawn on the disc; '' for none. */
	icon: string
}

export interface SkillTreeProps {
	treeId: string
	name: string
	goal: string
	/** `sectors` | `lineage` | `free` */
	layout: string
	/** Comma-separated, in order. */
	sectors: string
	rings: string
	/** The node id the tree is laid out from; empty for its node of kind root. */
	root: string
	autoHeight: boolean
}

export type SkillShape = TLShape & { type: typeof SKILL_TYPE; props: SkillNodeProps }
export type TreeShape = TLShape & { type: typeof TREE_TYPE; props: SkillTreeProps }

/** The tree id and node kind of Mastery, the tree every other tree can hang from. */
export const MASTERY = 'mastery'
/** Mastery's own node: the root of the Mastery tree. */
export const MASTERY_NODE = 'mastery/root'
/** Kinds whose ring is the share of everything below them that is unlocked, not a requirement. */
export const AGGREGATE_KINDS: readonly string[] = [MASTERY, 'pillar']

export function isSkill(shape: TLShape | undefined | null): shape is SkillShape {
	return shape?.type === SKILL_TYPE
}

export function isTree(shape: TLShape | undefined | null): shape is TreeShape {
	return shape?.type === TREE_TYPE
}

/** The nodes of one tree on this board. */
export function treeNodes(editor: Editor, treeId: string): SkillShape[] {
	return editor.getCurrentPageShapes().filter((s): s is SkillShape => isSkill(s) && s.props.treeId === treeId)
}

export const HABIT_TYPE = 'node.habit'

export interface HabitProps {
	habitId: string
	name: string
	goal: string
	/** `day` | `week` | `month` */
	period: string
	target: number
	/** YAML filter (`kind: Ship`), or '' to tick by hand. */
	counts: string
	/** An item id: the habit waits until that item is done. '' starts it at once. */
	startedBy: string
	/** `YYYY-MM-DD` the habit was made; periods before it don't count. */
	startedAt: string
	/** Hand ticks per period key, as JSON. */
	log: string
	/** `active` | `paused` */
	state: string
	autoHeight: boolean
}

export type HabitShape = TLShape & { type: typeof HABIT_TYPE; props: HabitProps }

export function isHabit(shape: TLShape | undefined | null): shape is HabitShape {
	return shape?.type === HABIT_TYPE
}

export const UP_NEXT_TYPE = 'node.upNext'

export interface UpNextProps {
	/** Only this goal's tracks and habits; '' for all of them. */
	goal: string
	autoHeight: boolean
}

/** Marks a shape an import created and nobody has confirmed yet (syllabusIO.ts). */
export const DRAFT_META = 'lifeboard:skillDraft'

/** A draft draws dashed and stays out of the index until "Confirm draft". */
export function isDraft(shape: TLShape): boolean {
	return !!shape.meta[DRAFT_META]
}

/** The class a card adds to its root while it is a draft. */
export function draftClass(shape: TLShape): string {
	return isDraft(shape) ? ' lb-draft' : ''
}
