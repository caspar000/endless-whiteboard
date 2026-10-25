import type { Editor, TLShape } from '@lifeboard/canvas'

/** The skill tree's shapes on a board: nodes, the header that holds a view, and the entries a view draws. */

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
	/** An `asset:` picture filling the disc, the way the middle of the whole-life tree shows you; '' for none. Kept on this board. */
	picture: string
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
	/** The node id the view starts from ("Show from"); empty for its node of kind root. */
	root: string
	/** What this board shows of the tree: skill nodes only (`overview`) or everything (`all`). */
	mode: string
	/** Live physics for this tree, from before the maze: kept so saved trees still load, no longer read. */
	live: string
	/** Where nodes were in each view of this tree on this board, as JSON: `{ context: { id: [x, y] } }`. */
	places: string
	autoHeight: boolean
}

export const VIEW_MODES = ['overview', 'all'] as const
export type ViewMode = (typeof VIEW_MODES)[number]

/** An entry (Homer) or a work (the Iliad) drawn in a tree view: a view of a vault item. */
export const ENTRY_TYPE = 'node.skillEntry'

export interface EntryProps {
	itemId: string
	/** The tree whose view put it here. */
	treeId: string
	/** `entry` (a small disc with a progress ring) or `work` (a dot with its title). */
	variant: string
}

export type EntryShape = TLShape & { type: typeof ENTRY_TYPE; props: EntryProps }

export function isEntry(shape: TLShape | undefined | null): shape is EntryShape {
	return shape?.type === ENTRY_TYPE
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

/** Marks a shape an import created and nobody has confirmed yet (treeIO.ts, and the syllabus's import). */
export const DRAFT_META = 'lifeboard:skillDraft'

/** A draft draws dashed and stays out of the index until "Confirm draft". */
export function isDraft(shape: TLShape): boolean {
	return !!shape.meta[DRAFT_META]
}

/** The class a card adds to its root while it is a draft. */
export function draftClass(shape: TLShape): string {
	return isDraft(shape) ? ' lb-draft' : ''
}
