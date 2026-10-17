import { atom, type Editor, type TLShape } from '@lifeboard/canvas'
import { isImporting, onImportEnd } from './importing'
import { isDraft, isHabit, NOTE_TYPE, type HabitShape } from './board'
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
 * data now (syllabus.ts); what still lives on boards is write-up notes and habit cards, and this
 * keeps a vault-wide copy of each so any board can read them. Each open board feeds it through its
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
 * Feeds the vault's copies from a board's own store: write-up notes and habit cards. Called from
 * `onBoardOpen`; idempotent per editor, since a board's editor lives as long as its tab. The side
 * effects only read the board and write the vault, never the board.
 */
export function watchBoard(editor: Editor, boardId: string): void {
	const known = watched.get(editor)
	watched.set(editor, boardId)
	if (known === undefined) {
		const board = () => watched.get(editor) ?? boardId
		const seen = (shape: TLShape) => {
			if (isImporting()) return
			if (reindexEntity(board(), shape)) return
			if (!isNote(shape)) return
			const entry = evidenceOfNote(board(), shape)
			if (entry) putEvidence(entry)
			else removeEvidence(board(), shape.id)
		}
		editor.sideEffects.registerAfterCreateHandler('shape', seen)
		editor.sideEffects.registerAfterChangeHandler('shape', (_prev, next) => seen(next))
		editor.sideEffects.registerAfterDeleteHandler('shape', (shape) => {
			if (isImporting()) return
			if (unindexEntity(board(), shape)) return
			if (isNote(shape)) removeEvidence(board(), shape.id)
		})
	}
	rescanNotes(editor, boardId)
	rescanEntities(editor, boardId)
}

// A bulk change skipped the side effects above; one rescan catches the board up.
onImportEnd((editor) => {
	const boardId = watched.get(editor)
	if (boardId === undefined) return
	rescanNotes(editor, boardId)
	rescanEntities(editor, boardId)
})

/** Clears everything, for tests. */
export function resetSkillIndex(): void {
	resetSyllabus()
	habitStore.reset()
}

/**
 * A vault-wide copy of one kind of shape (habit cards), so a card on one board can read what is
 * kept on another. The shape stays the truth; this is a copy, refreshed by the same side effects and
 * rescans as the item index, and persisted by the app under its own vault setting.
 */
interface Located {
	boardId: string
	shapeId: string
}

function entityStore<T extends Located>(name: string, idOf: (entry: T) => string, parse: (raw: Record<string, unknown>) => T | null) {
	const store = atom<Readonly<Record<string, T>>>(name, {})
	let persistStore: ((value: Readonly<Record<string, T>>) => void) | null = null
	const commitStore = (next: Record<string, T>) => {
		if (JSON.stringify(next) === JSON.stringify(store.get())) return
		store.set(next)
		persistStore?.(next)
	}
	return {
		get: () => store.get(),
		setPersistence: (listener: ((value: Readonly<Record<string, T>>) => void) | null) => {
			persistStore = listener
		},
		replace(raw: unknown) {
			if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
			const next: Record<string, T> = {}
			for (const value of Object.values(raw as Record<string, unknown>)) {
				if (!value || typeof value !== 'object') continue
				const entry = parse(value as Record<string, unknown>)
				if (entry && idOf(entry) && entry.boardId) next[idOf(entry)] = entry
			}
			store.set(next)
		},
		upsert(entry: T) {
			if (idOf(entry)) commitStore({ ...store.get(), [idOf(entry)]: entry })
		},
		remove(boardId: string, shapeId: string, id: string) {
			const existing = store.get()[id]
			if (!existing || existing.boardId !== boardId || existing.shapeId !== shapeId) return
			const next = { ...store.get() }
			delete next[id]
			commitStore(next)
		},
		rescan(boardId: string, entries: readonly T[]) {
			const next: Record<string, T> = {}
			for (const [id, entry] of Object.entries(store.get())) if (entry.boardId !== boardId) next[id] = entry
			for (const entry of entries) if (idOf(entry)) next[idOf(entry)] = entry
			commitStore(next)
		},
		reset: () => store.set({}),
	}
}

const str = (raw: Record<string, unknown>, key: string) => (typeof raw[key] === 'string' ? (raw[key] as string) : '')

export interface HabitEntry extends Located {
	habitId: string
	name: string
	goal: string
	period: string
	target: number
	counts: string
	startedBy: string
	startedAt: string
	log: string
	state: string
}

export type HabitIndex = Readonly<Record<string, HabitEntry>>

const habitStore = entityStore<HabitEntry>('lifeboard:skill-habits', (e) => e.habitId, (raw) => ({
	habitId: str(raw, 'habitId'),
	name: str(raw, 'name'),
	goal: str(raw, 'goal'),
	period: str(raw, 'period') || 'week',
	target: typeof raw.target === 'number' ? raw.target : 1,
	counts: str(raw, 'counts'),
	startedBy: str(raw, 'startedBy'),
	startedAt: str(raw, 'startedAt'),
	log: str(raw, 'log'),
	state: str(raw, 'state') || 'active',
	boardId: str(raw, 'boardId'),
	shapeId: str(raw, 'shapeId'),
}))

export const getHabitIndex = (): HabitIndex => habitStore.get()
export const setHabitIndexPersistence = habitStore.setPersistence
export const replaceHabitIndex = habitStore.replace

function habitEntryFor(boardId: string, habit: HabitShape): HabitEntry {
	const { habitId, name, goal, period, target, counts, startedBy, startedAt, log, state } = habit.props
	return { habitId, name, goal, period, target, counts, startedBy, startedAt, log, state, boardId, shapeId: habit.id }
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

/** Indexes a habit card that changed. False for any other shape. */
function reindexEntity(boardId: string, shape: TLShape): boolean {
	if (!isHabit(shape)) return false
	if (isDraft(shape)) return unindexEntity(boardId, shape)
	habitStore.upsert(habitEntryFor(boardId, shape))
	return true
}

function unindexEntity(boardId: string, shape: TLShape): boolean {
	if (!isHabit(shape)) return false
	habitStore.remove(boardId, shape.id, shape.props.habitId)
	return true
}

function rescanEntities(editor: Editor, boardId: string): void {
	const live = editor.getCurrentPageShapes().filter((s) => !isDraft(s))
	habitStore.rescan(boardId, live.filter(isHabit).map((h) => habitEntryFor(boardId, h)))
}
