import type { Editor, TLShape } from '@lifeboard/canvas'
import { readText } from './properties'

/**
 * The syllabus's shapes on a board. Items and tracks are vault data (syllabus.ts); these shapes are
 * views of them: a card shows one item, a list shows one track.
 */

export const ITEM_TYPE = 'node.skillItem'
export const TRACK_TYPE = 'node.track'
export const NOTE_TYPE = 'node.markdown'

/** A card: one vault item, its works as a checklist inside. */
export interface SkillItemProps {
	itemId: string
	autoHeight: boolean
}

/** A list: one vault track as an outline, in reading order. */
export interface TrackProps {
	trackId: string
	/** Item ids unfolded on this card, newline-separated: how it is folded is this board's business. */
	open: string
}

export type ItemShape = TLShape & { type: typeof ITEM_TYPE; props: SkillItemProps }
export type TrackShape = TLShape & { type: typeof TRACK_TYPE; props: TrackProps }

export function isItem(shape: TLShape | undefined | null): shape is ItemShape {
	return shape?.type === ITEM_TYPE
}

export function isTrack(shape: TLShape | undefined | null): shape is TrackShape {
	return shape?.type === TRACK_TYPE
}

/** The note filed as this item's write-up, if there is one on this board. */
export function evidenceNoteFor(editor: Editor, itemId: string): TLShape | undefined {
	if (!itemId) return undefined
	return editor
		.getCurrentPageShapes()
		// `node.markdown` is the notes package's type; this package doesn't import its shape types.
		.find((shape) => (shape.type as string) === NOTE_TYPE && readText(shape, 'evidenceOf') === itemId)
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
