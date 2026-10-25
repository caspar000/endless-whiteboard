import type { Editor, TLShape } from '@lifeboard/canvas'
import { isImporting, onImportEnd } from '@lifeboard/skill-tree'
import { NOTE_TYPE } from './board'
import { hasEvidence } from './model'
import { readText } from './properties'
import {
	getItem,
	getTracks,
	putEvidence,
	removeEvidence,
	rescanEvidence,
	resetSyllabus,
	type EvidenceEntry,
} from './syllabus'
import { templateFor } from './templates'

/**
 * What open boards tell the vault (docs/skill-tree-plan.md, "The index"). Items and tracks are vault
 * data now (syllabus.ts); what still lives on boards is write-up notes, and this keeps a vault-wide
 * copy of them so any board can read them. Each open board feeds it through its
 * store's side effects, and rescans itself when it opens.
 */
export { getSkillIndex, type IndexEntry, type SkillIndex } from './syllabus'

/** A write-up note's evidence: whose it is, and whether it holds more than its template. */
function evidenceOfNote(boardId: string, note: TLShape): EvidenceEntry | null {
	const itemId = readText(note, 'evidenceOf')
	if (!itemId) return null
	const md = String((note.props as { md?: unknown }).md ?? '')
	return { itemId, boardId, shapeId: note.id, written: hasEvidence(md, templateFor(getItem(itemId)?.medium ?? '').md), method: readText(note, 'method') }
}

const isNote = (shape: TLShape) => (shape.type as string) === NOTE_TYPE

/** Every note on the board that is somebody's write-up. */
function rescanNotes(editor: Editor, boardId: string): void {
	rescanEvidence(
		boardId,
		editor.getCurrentPageShapes().flatMap((s) => (isNote(s) ? (evidenceOfNote(boardId, s) ?? []) : []))
	)
}

const watched = new WeakMap<Editor, string>()

/** The board an open editor shows, as `onBoardOpen` reported it. */
export function boardIdOf(editor: Editor): string | undefined {
	return watched.get(editor)
}

/**
 * Feeds the vault's copy from a board's own store: write-up notes. Called from `onBoardOpen`;
 * idempotent per editor, since a board's editor lives as long as its tab. The side effects only
 * read the board and write the vault, never the board.
 */
export function watchBoard(editor: Editor, boardId: string): void {
	const known = watched.get(editor)
	watched.set(editor, boardId)
	if (known === undefined) {
		const board = () => watched.get(editor) ?? boardId
		const seen = (shape: TLShape) => {
			if (isImporting()) return
			if (!isNote(shape)) return
			const entry = evidenceOfNote(board(), shape)
			if (entry) putEvidence(entry)
			else removeEvidence(board(), shape.id)
		}
		editor.sideEffects.registerAfterCreateHandler('shape', seen)
		editor.sideEffects.registerAfterChangeHandler('shape', (_prev, next) => seen(next))
		editor.sideEffects.registerAfterDeleteHandler('shape', (shape) => {
			if (isImporting()) return
			if (isNote(shape)) removeEvidence(board(), shape.id)
		})
	}
	rescanNotes(editor, boardId)
}

// A bulk change skipped the side effects above; one rescan catches the board up.
onImportEnd((editor) => {
	const boardId = watched.get(editor)
	if (boardId === undefined) return
	rescanNotes(editor, boardId)
})

/** Clears everything, for tests. */
export function resetSkillIndex(): void {
	resetSyllabus()
}

/** A track as Up Next reads it: the vault's tracks, confirmed ones only. */
export interface TrackEntry {
	trackId: string
	name: string
	goal: string
	state: string
	order: string[]
}

export type TrackIndex = Readonly<Record<string, TrackEntry>>

export const getTrackIndex = (): TrackIndex =>
	Object.fromEntries(
		Object.values(getTracks())
			.filter((t) => !t.draft)
			.map(({ trackId, name, goal, state, order }) => [trackId, { trackId, name, goal, state, order }])
	)
