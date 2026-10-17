import { atom, type Editor, type TLShape, type TLShapeId } from '@lifeboard/canvas'
import { childrenOf, evidenceNoteFor, isHabit, isItem, isOrphan, NOTE_TYPE, type HabitShape, type ItemShape } from './board'
import { hasEvidence, parseTags } from './model'
import { isDone, readText } from './properties'
import { templateFor } from './templates'

/**
 * Every syllabus item in the vault, readable from any board (docs/skill-tree-plan.md, "The index").
 *
 * Lifeboard can't read a board without mounting its editor, so this is written as things change:
 * each open board feeds it through its store's side effects (`watchBoard`), and a board rescans itself
 * when it opens, which also catches what changed on another device. The app persists it like saved
 * card layouts: localStorage as the cache, the server vault as the truth.
 */
export interface IndexEntry {
	itemId: string
	title: string
	kind: string
	medium: string
	/** The item's own tags plus every ancestor's: a dialogue counts for what Plato counts for. */
	tags: string[]
	done: boolean
	doneAt: string
	/** Done, and the evidence note holds something beyond its template. */
	evidence: boolean
	method: string
	core: boolean
	parentItemId: string
	hasChildren: boolean
	boardId: string
	shapeId: string
}

export type SkillIndex = Readonly<Record<string, IndexEntry>>

const index = atom<SkillIndex>('lifeboard:skill-index', {})
let persist: ((value: SkillIndex) => void) | null = null

export function getSkillIndex(): SkillIndex {
	return index.get()
}

/** The app's hook for saving the index wherever it keeps vault settings. */
export function setSkillIndexPersistence(listener: ((value: SkillIndex) => void) | null): void {
	persist = listener
}

/** Takes a stored or synced index as the truth. Malformed entries are dropped one by one. */
export function replaceSkillIndex(raw: unknown): void {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
	const next: Record<string, IndexEntry> = {}
	for (const value of Object.values(raw as Record<string, unknown>)) {
		const entry = parseEntry(value)
		if (entry) next[entry.itemId] = entry
	}
	index.set(next)
}

function parseEntry(value: unknown): IndexEntry | null {
	if (!value || typeof value !== 'object') return null
	const v = value as Record<string, unknown>
	const str = (key: string) => (typeof v[key] === 'string' ? (v[key] as string) : '')
	const bool = (key: string) => v[key] === true
	if (!str('itemId') || !str('boardId')) return null
	return {
		itemId: str('itemId'),
		title: str('title'),
		kind: str('kind'),
		medium: str('medium'),
		tags: Array.isArray(v.tags) ? v.tags.filter((t): t is string => typeof t === 'string') : [],
		done: bool('done'),
		doneAt: str('doneAt'),
		evidence: bool('evidence'),
		method: str('method'),
		core: bool('core'),
		parentItemId: str('parentItemId'),
		hasChildren: bool('hasChildren'),
		boardId: str('boardId'),
		shapeId: str('shapeId'),
	}
}

function commit(next: Record<string, IndexEntry>): void {
	if (JSON.stringify(next) === JSON.stringify(index.get())) return
	index.set(next)
	persist?.(next)
}

/** What the index should say about one item shape, as it stands on its board now. */
export function entryFor(editor: Editor, boardId: string, item: ItemShape): IndexEntry {
	const children = childrenOf(editor, item.id)
	const done = isDone(item)
	const note = evidenceNoteFor(editor, item.props.itemId)
	const md = note ? String((note.props as { md?: unknown }).md ?? '') : ''
	const medium = readText(item, 'medium')
	return {
		itemId: item.props.itemId,
		title: item.props.title,
		kind: readText(item, 'kind'),
		medium,
		tags: effectiveTags(editor, item),
		done,
		doneAt: readText(item, 'doneAt'),
		evidence: done && children.length === 0 && hasEvidence(md, templateFor(medium).md),
		method: note ? readText(note, 'method') : '',
		core: item.props.core,
		parentItemId: parentOf(editor, item)?.props.itemId ?? '',
		hasChildren: children.length > 0,
		boardId,
		shapeId: item.id,
	}
}

function parentOf(editor: Editor, item: ItemShape): ItemShape | null {
	const parent = item.props.parentId ? editor.getShape(item.props.parentId as TLShapeId) : undefined
	return isItem(parent) ? parent : null
}

function effectiveTags(editor: Editor, item: ItemShape): string[] {
	const tags = new Set<string>()
	let current: ItemShape | null = item
	for (let depth = 0; current && depth < 16; depth++) {
		for (const tag of parseTags(current.props.tags)) tags.add(tag)
		current = parentOf(editor, current)
	}
	return [...tags]
}

/** The item and its descendants: what one change to a parent can alter in the index. */
function family(editor: Editor, item: ItemShape, depth = 0): ItemShape[] {
	if (depth > 16) return [item]
	return [item, ...childrenOf(editor, item.id).flatMap((child) => family(editor, child, depth + 1))]
}

/** Ancestors, nearest first. A child's tick changes its parent's Done and hasChildren. */
function ancestors(editor: Editor, item: ItemShape): ItemShape[] {
	const out: ItemShape[] = []
	let current = parentOf(editor, item)
	for (let depth = 0; current && depth < 16; depth++) {
		out.push(current)
		current = parentOf(editor, current)
	}
	return out
}

/** Re-reads the items a change to this shape can affect, and writes them in one commit. */
export function reindexShape(editor: Editor, boardId: string, shape: TLShape): void {
	let items: ItemShape[] = []
	if (isItem(shape)) items = [...family(editor, shape), ...ancestors(editor, shape)]
	else if ((shape.type as string) === NOTE_TYPE) {
		const of = readText(shape, 'evidenceOf')
		const item = of ? editor.getCurrentPageShapes().find((s) => isItem(s) && s.props.itemId === of) : undefined
		if (isItem(item)) items = [item]
	}
	if (items.length === 0) return
	const next = { ...index.get() }
	for (const item of items) {
		if (!item.props.itemId) continue
		if (isOrphan(editor, item)) delete next[item.props.itemId]
		else next[item.props.itemId] = entryFor(editor, boardId, item)
	}
	commit(next)
}

/**
 * Drops an item whose shape was deleted, and the descendants it leaves hidden, unless an id has since
 * moved to another shape or board.
 */
export function unindexShape(editor: Editor, boardId: string, shape: TLShape): void {
	if (!isItem(shape)) return
	const gone = [shape, ...editor.getCurrentPageShapes().filter((s) => isItem(s) && isOrphan(editor, s))]
	const next = { ...index.get() }
	for (const item of gone) {
		if (!isItem(item)) continue
		const existing = next[item.props.itemId]
		if (existing && existing.boardId === boardId && existing.shapeId === item.id) delete next[item.props.itemId]
	}
	commit(next)
}

/** Deletes items whose parent is gone. Run when a board opens, when no undo can want them back. */
export function sweepOrphans(editor: Editor): void {
	const orphans = editor.getCurrentPageShapes().filter((s) => isItem(s) && isOrphan(editor, s))
	if (orphans.length) editor.deleteShapes(orphans.map((s) => s.id))
}

/**
 * Brings the index in line with a board: every item on it, and none that claims this board but is
 * gone from it. Run when the board opens.
 */
export function rescanBoard(editor: Editor, boardId: string): void {
	const next: Record<string, IndexEntry> = {}
	for (const [id, entry] of Object.entries(index.get())) if (entry.boardId !== boardId) next[id] = entry
	for (const shape of editor.getCurrentPageShapes()) {
		if (isItem(shape) && shape.props.itemId && !isOrphan(editor, shape)) next[shape.props.itemId] = entryFor(editor, boardId, shape)
	}
	commit(next)
}

const watched = new WeakMap<Editor, string>()

/** The board an open editor shows, as `onBoardOpen` reported it. */
export function boardIdOf(editor: Editor): string | undefined {
	return watched.get(editor)
}

/**
 * Feeds the index from a board's own store, and sweeps the children of deleted parents. Called from
 * `onBoardOpen`; idempotent per editor, since a board's editor lives as long as its tab.
 *
 * Side effects rather than the extension hooks: hooks see creates and property changes, and the index
 * needs prop changes (a title, a tag, a parent) and deletions too. They only read the board and write
 * the index; nothing here writes to the store from inside a side effect, which this canvas's undo
 * would not record.
 */
export function watchBoard(editor: Editor, boardId: string): void {
	const known = watched.get(editor)
	watched.set(editor, boardId)
	if (known === undefined) {
		const relevant = (shape: TLShape) => isItem(shape) || (shape.type as string) === NOTE_TYPE
		editor.sideEffects.registerAfterCreateHandler('shape', (shape) => {
			if (isHabit(shape)) reindexHabit(watched.get(editor) ?? boardId, shape)
			else if (relevant(shape)) reindexShape(editor, watched.get(editor) ?? boardId, shape)
		})
		editor.sideEffects.registerAfterChangeHandler('shape', (_prev, next) => {
			if (isHabit(next)) reindexHabit(watched.get(editor) ?? boardId, next)
			else if (relevant(next)) reindexShape(editor, watched.get(editor) ?? boardId, next)
		})
		editor.sideEffects.registerAfterDeleteHandler('shape', (shape) => {
			if (isHabit(shape)) {
				unindexHabit(watched.get(editor) ?? boardId, shape)
				return
			}
			if (!isItem(shape)) {
				if ((shape.type as string) === NOTE_TYPE) reindexEvidenceOwner(editor, watched.get(editor) ?? boardId, shape)
				return
			}
			// Its children stay, hidden, so an undo brings the family back whole (board.ts).
			unindexShape(editor, watched.get(editor) ?? boardId, shape)
			// The parent's own entry changes too (hasChildren, Done).
			const parent = shape.props.parentId ? editor.getShape(shape.props.parentId as TLShapeId) : undefined
			if (isItem(parent)) reindexShape(editor, watched.get(editor) ?? boardId, parent)
		})
		sweepOrphans(editor)
	}
	rescanBoard(editor, boardId)
	rescanHabits(editor, boardId)
}

/** A deleted evidence note takes the evidence with it. */
function reindexEvidenceOwner(editor: Editor, boardId: string, note: TLShape): void {
	const of = readText(note, 'evidenceOf')
	if (!of) return
	const item = editor.getCurrentPageShapes().find((s) => isItem(s) && s.props.itemId === of)
	if (isItem(item)) reindexShape(editor, boardId, item)
}

/** Clears everything, for tests. */
export function resetSkillIndex(): void {
	index.set({})
	habits.set({})
}

/**
 * Every habit in the vault, so a skill node on one board can ask about a habit kept on another.
 * The habit's shape is the truth (its hand ticks live in its props); this is a copy, kept and
 * persisted the same way as the item index, under its own vault setting.
 */
export interface HabitEntry {
	habitId: string
	name: string
	period: string
	target: number
	counts: string
	startedBy: string
	startedAt: string
	log: string
	state: string
	boardId: string
	shapeId: string
}

export type HabitIndex = Readonly<Record<string, HabitEntry>>

const habits = atom<HabitIndex>('lifeboard:skill-habits', {})
let persistHabits: ((value: HabitIndex) => void) | null = null

export function getHabitIndex(): HabitIndex {
	return habits.get()
}

export function setHabitIndexPersistence(listener: ((value: HabitIndex) => void) | null): void {
	persistHabits = listener
}

export function replaceHabitIndex(raw: unknown): void {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
	const next: Record<string, HabitEntry> = {}
	for (const value of Object.values(raw as Record<string, unknown>)) {
		if (!value || typeof value !== 'object') continue
		const v = value as Record<string, unknown>
		const str = (key: string) => (typeof v[key] === 'string' ? (v[key] as string) : '')
		if (!str('habitId') || !str('boardId')) continue
		next[str('habitId')] = {
			habitId: str('habitId'),
			name: str('name'),
			period: str('period') || 'week',
			target: typeof v.target === 'number' ? v.target : 1,
			counts: str('counts'),
			startedBy: str('startedBy'),
			startedAt: str('startedAt'),
			log: str('log'),
			state: str('state') || 'active',
			boardId: str('boardId'),
			shapeId: str('shapeId'),
		}
	}
	habits.set(next)
}

function commitHabits(next: Record<string, HabitEntry>): void {
	if (JSON.stringify(next) === JSON.stringify(habits.get())) return
	habits.set(next)
	persistHabits?.(next)
}

function habitEntryFor(boardId: string, habit: HabitShape): HabitEntry {
	const p = habit.props
	return {
		habitId: p.habitId,
		name: p.name,
		period: p.period,
		target: p.target,
		counts: p.counts,
		startedBy: p.startedBy,
		startedAt: p.startedAt,
		log: p.log,
		state: p.state,
		boardId,
		shapeId: habit.id,
	}
}

function reindexHabit(boardId: string, habit: HabitShape): void {
	if (!habit.props.habitId) return
	commitHabits({ ...habits.get(), [habit.props.habitId]: habitEntryFor(boardId, habit) })
}

function unindexHabit(boardId: string, habit: HabitShape): void {
	const existing = habits.get()[habit.props.habitId]
	if (!existing || existing.boardId !== boardId || existing.shapeId !== habit.id) return
	const next = { ...habits.get() }
	delete next[habit.props.habitId]
	commitHabits(next)
}

function rescanHabits(editor: Editor, boardId: string): void {
	const next: Record<string, HabitEntry> = {}
	for (const [id, entry] of Object.entries(habits.get())) if (entry.boardId !== boardId) next[id] = entry
	for (const shape of editor.getCurrentPageShapes()) {
		if (isHabit(shape) && shape.props.habitId) next[shape.props.habitId] = habitEntryFor(boardId, shape)
	}
	commitHabits(next)
}
