import { createShapeId, type Editor, type TLShapeId } from '@lifeboard/canvas'
import { isExtensionEnabled } from '@lifeboard/node-kit'
import {
	boardHasTreeDraft,
	confirmTrees,
	discardTrees,
	DRAFT_META,
	importTrees,
	isDraft,
	SKILL_TREE_EXTENSION,
	treeDoc,
	treeGoals,
	treePrefix,
	whileImporting,
} from '@lifeboard/skill-tree'
import { stringify as stringifyYaml } from 'yaml'
import { isTrack, TRACK_TYPE } from './board'
import { TRACK_WIDTH } from './ops'
import { boardIdOf } from './skillIndex'
import { confirmDrafts, discardDrafts, getItems, getTracks, hasDrafts, putItems, putTracks, type ItemDef } from './syllabus'
import { mergeDoc } from './syllabusMerge'
import type { SyllabusDoc } from './syllabusYaml'

/**
 * Putting a syllabus document into the vault and its tree on a board, and taking one out
 * (docs/skill-tree-plan.md, "The YAML format" and "Drafts").
 *
 * Items and tracks go into the vault (syllabusMerge.ts), and the board gets a list of each track. The
 * document's trees go to the skill tree (its treeIO.ts) when that extension is on, and are left out
 * when it is off; they wait in the vault for "Show a skill tree on this board", so a syllabus arrives
 * as something to read and its tree is a view you ask for. A document with no tracks (only a tree)
 * shows its tree, as there would be nothing else to show. An import is a
 * **draft**: what it makes is marked as this board's draft, draws dashed, and stays out of the index
 * until Confirm on the board's draft bar (DraftBar.tsx). Ids that already exist are updated in place instead (titles, tags,
 * requirements; never a tick or a note), so a YAML file can be edited and imported again.
 */

export interface ImportResult {
	/** New items and tracks in the vault, and new shapes on the board. */
	created: number
	updated: number
	draftIds: TLShapeId[]
}

/** The board an import is a draft of: the one its editor shows. */
const boardOf = (editor: Editor) => boardIdOf(editor) ?? 'board'

/** Whether a document's trees go anywhere: only with the skill tree on. */
const treesOn = () => isExtensionEnabled(SKILL_TREE_EXTENSION)

/**
 * What an import puts on the board: `lists` (the default) a list per track, or the tree views when
 * the document has no tracks; `trees` the tree views and no lists.
 */
export type ImportShows = 'lists' | 'trees'

export function importSyllabus(editor: Editor, doc: SyllabusDoc, at: { x: number; y: number }, shows: ImportShows = 'lists'): ImportResult {
	return whileImporting(editor, () => importNow(editor, doc, at, shows))
}

const LIST_GAP = 40

function importNow(editor: Editor, doc: SyllabusDoc, at: { x: number; y: number }, shows: ImportShows): ImportResult {
	const before = new Set(editor.getCurrentPageShapeIds())
	let updated = 0
	let vaultCreated = 0
	editor.run(() => {
		editor.markHistoryStoppingPoint('import syllabus')

		const merged = mergeDoc(doc, getItems(), getTracks(), boardOf(editor))
		putItems(merged.items)
		putTracks(merged.tracks)
		vaultCreated = merged.created
		updated += merged.updated

		const lists = shows === 'lists' && doc.tracks.length > 0
		if (treesOn()) {
			const trees = importTrees(editor, doc.trees, at, boardOf(editor), !lists)
			vaultCreated += trees.created
			updated += trees.updated
		}
		if (lists) {
			// Side by side, each track once: importing the file again leaves this board's lists where they are.
			const listed = new Set(editor.getCurrentPageShapes().filter(isTrack).map((s) => s.props.trackId))
			let x = at.x
			for (const track of doc.tracks) {
				if (listed.has(track.trackId)) continue
				editor.createShape({ id: createShapeId(), type: TRACK_TYPE, parentId: editor.getCurrentPageId(), x, y: at.y, props: { trackId: track.trackId } } as never)
				x += TRACK_WIDTH + LIST_GAP
			}
		}
		// The cards this import made (headers) are the draft on the board; the vault marks the rest.
		for (const shape of editor.getCurrentPageShapes()) {
			if (!before.has(shape.id)) editor.updateShape({ id: shape.id, type: shape.type, meta: { [DRAFT_META]: true } } as never)
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
	const vault = confirmDrafts(boardOf(editor)) + confirmTrees(editor, boardOf(editor))
	if (!drafts.length) return vault
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
	const trees = discardTrees(editor, boardOf(editor))
	const drafts = [...new Set([...editor.getCurrentPageShapes().filter(isDraft), ...trees.shapes])]
	const vault = discardDrafts(boardOf(editor)) + trees.nodes
	if (!drafts.length) return vault
	editor.run(() => {
		editor.markHistoryStoppingPoint('discard draft')
		editor.deleteShapes(drafts.map((s) => s.id))
	})
	return drafts.length + vault
}

/** Whether this board has a draft waiting: shapes, or vault items and tracks its imports made. */
export function boardHasDraft(editor: Editor): boolean {
	return hasDrafts(boardOf(editor)) || boardHasTreeDraft(boardOf(editor)) || editor.getCurrentPageShapes().some(isDraft)
}

/** The goals there are syllabi for, by name: the vault's tracks, and this board's trees. */
export function boardGoals(editor: Editor): string[] {
	const goals = [...Object.values(getTracks()).filter((t) => !t.draft).map((t) => t.goal), ...treeGoals(editor)]
	return [...new Set(goals.filter(Boolean))]
}

/**
 * One goal's syllabus as YAML (the first goal if none is named): its tracks with their items, from
 * the vault, and this board's tree for it. One goal per document, because an import gives everything
 * in it the document's goal. Ids are written in full, so importing the result again updates rather
 * than duplicates.
 */
export function exportSyllabus(editor: Editor, goalName?: string): string {
	const goal = goalName || boardGoals(editor)[0] || 'goal'
	const tracks = Object.values(getTracks()).filter((t) => !t.draft && (t.goal === goal || (!t.goal && !goalName)))
	const prefix = (tracks[0]?.trackId || treePrefix(editor, goal, !goalName)).split('/')[0]
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
	const tree = treeDoc(editor, goal, !goalName)
	if (tree) doc.tree = tree
	return stringifyYaml(doc, { lineWidth: 0 })
}
