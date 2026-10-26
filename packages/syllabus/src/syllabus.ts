import { atom, computed } from '@lifeboard/canvas'
import { childProgress, makeItemId, parseChildRule, todayIso, type ChildProgress } from './model'

/**
 * The syllabus as vault data (docs/skill-tree-plan.md, "Rebuild: one syllabus, many views"): every
 * item and its works, every track, and the write-ups found on boards. Every view (the tree, the list,
 * Up Next, a card) reads and writes these, so a tick anywhere is a tick everywhere.
 *
 * Writes here are not on any board's undo stack: they are not a board's data. Ticking again undoes a
 * tick.
 */
export interface ItemDef {
	itemId: string
	title: string
	kind: string
	medium: string
	/** Skill node ids this item feeds; its works feed them too. */
	tags: string[]
	/** One of the works its parent's `core` rule waits for. */
	core: boolean
	/** `core` | `all` | `n:3`: when a parent is done. */
	childRule: string
	/** The parent item's id, '' at the top. */
	parent: string
	/** Its works, in order. */
	children: string[]
	/** A leaf's tick; a parent's is worked out from its children. */
	done: boolean
	doneAt: string
	/** The board whose import made this and has not confirmed it yet; '' once confirmed. */
	draft: string
}

export interface TrackDef {
	trackId: string
	name: string
	goal: string
	/** `active` | `paused` | `notStarted` */
	state: string
	/** Top-level item ids, in reading order. */
	order: string[]
	defaultTags: string[]
	draft: string
}

/** A write-up note seen on a board: whose evidence it is, and whether it holds more than its template. */
export interface EvidenceEntry {
	itemId: string
	boardId: string
	shapeId: string
	written: boolean
	method: string
}

type Items = Readonly<Record<string, ItemDef>>
type Tracks = Readonly<Record<string, TrackDef>>
type Evidence = Readonly<Record<string, EvidenceEntry>>

function store<T>(name: string) {
	const value = atom<Readonly<Record<string, T>>>(name, {})
	let persist: ((v: Readonly<Record<string, T>>) => void) | null = null
	return {
		get: () => value.get(),
		set(next: Readonly<Record<string, T>>) {
			if (JSON.stringify(next) === JSON.stringify(value.get())) return
			value.set(next)
			persist?.(next)
		},
		/** Loads a stored copy without saving it back. */
		load: (next: Readonly<Record<string, T>>) => value.set(next),
		setPersistence: (listener: ((v: Readonly<Record<string, T>>) => void) | null) => {
			persist = listener
		},
	}
}

const items = store<ItemDef>('lifeboard:syllabus-items')
const tracks = store<TrackDef>('lifeboard:syllabus-tracks')
const evidence = store<EvidenceEntry>('lifeboard:syllabus-evidence')

export const getItems = (): Items => items.get()
export const getItem = (itemId: string): ItemDef | undefined => items.get()[itemId]
export const getTracks = (): Tracks => tracks.get()
export const getTrack = (trackId: string): TrackDef | undefined => tracks.get()[trackId]
export const getEvidence = (): Evidence => evidence.get()

export const setItemsPersistence = items.setPersistence
export const setTracksPersistence = tracks.setPersistence
export const setEvidencePersistence = evidence.setPersistence

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const record = (raw: unknown) => (raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.values(raw as Record<string, unknown>) : [])
const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : null)

export function parseItem(raw: unknown): ItemDef | null {
	const r = obj(raw)
	if (!r || !str(r.itemId)) return null
	return {
		itemId: str(r.itemId),
		title: str(r.title),
		kind: str(r.kind),
		medium: str(r.medium),
		tags: strs(r.tags),
		core: r.core === true,
		childRule: str(r.childRule) || 'core',
		parent: str(r.parent),
		children: strs(r.children),
		done: r.done === true,
		doneAt: str(r.doneAt),
		draft: str(r.draft),
	}
}

export function parseTrack(raw: unknown): TrackDef | null {
	const r = obj(raw)
	if (!r || !str(r.trackId)) return null
	return {
		trackId: str(r.trackId),
		name: str(r.name),
		goal: str(r.goal),
		state: str(r.state) || 'notStarted',
		order: strs(r.order),
		defaultTags: strs(r.defaultTags),
		draft: str(r.draft),
	}
}

function parseEvidence(raw: unknown): EvidenceEntry | null {
	const r = obj(raw)
	if (!r || !str(r.itemId) || !str(r.boardId) || !str(r.shapeId)) return null
	return { itemId: str(r.itemId), boardId: str(r.boardId), shapeId: str(r.shapeId), written: r.written === true, method: str(r.method) }
}

const keyed = <T>(list: (T | null)[], key: (t: T) => string) => Object.fromEntries(list.filter((t): t is T => !!t).map((t) => [key(t), t]))
const evidenceKey = (e: Pick<EvidenceEntry, 'boardId' | 'shapeId'>) => `${e.boardId} ${e.shapeId}`

export const replaceItems = (raw: unknown) => items.load(keyed(record(raw).map(parseItem), (i) => i.itemId))
export const replaceTracks = (raw: unknown) => tracks.load(keyed(record(raw).map(parseTrack), (t) => t.trackId))
export const replaceEvidence = (raw: unknown) => evidence.load(keyed(record(raw).map(parseEvidence), evidenceKey))

export function resetSyllabus(): void {
	items.load({})
	tracks.load({})
	evidence.load({})
}

// ---- Items

/** Adds or replaces items in one write. A child also lands in its parent's list of works. */
export function putItems(defs: readonly ItemDef[]): void {
	if (!defs.length) return
	const next: Record<string, ItemDef> = { ...items.get() }
	for (const def of defs) next[def.itemId] = def
	for (const def of defs) {
		const parent = def.parent ? next[def.parent] : undefined
		if (parent && !parent.children.includes(def.itemId)) next[parent.itemId] = { ...parent, children: [...parent.children, def.itemId] }
	}
	items.set(next)
}

export function updateItem(itemId: string, patch: Partial<Omit<ItemDef, 'itemId'>>): void {
	const item = items.get()[itemId]
	if (item) items.set({ ...items.get(), [itemId]: { ...item, ...patch } })
}

/** Removes items and everything under them, and takes them out of their parents and tracks. */
export function removeItems(itemIds: readonly string[]): void {
	const all = items.get()
	const gone = new Set<string>()
	const walk = (id: string) => {
		if (gone.has(id) || !all[id]) return
		gone.add(id)
		all[id]!.children.forEach(walk)
	}
	itemIds.forEach(walk)
	if (!gone.size) return
	const next: Record<string, ItemDef> = {}
	for (const [id, item] of Object.entries(all)) {
		if (gone.has(id)) continue
		next[id] = item.children.some((c) => gone.has(c)) ? { ...item, children: item.children.filter((c) => !gone.has(c)) } : item
	}
	items.set(next)
	const nextTracks: Record<string, TrackDef> = {}
	for (const [id, track] of Object.entries(tracks.get())) {
		nextTracks[id] = track.order.some((o) => gone.has(o)) ? { ...track, order: track.order.filter((o) => !gone.has(o)) } : track
	}
	tracks.set(nextTracks)
}

/** Ticks or unticks a leaf. A parent's tick is worked out from its works, so it is left alone. */
export function setDone(itemId: string, done: boolean, today = todayIso()): boolean {
	const item = items.get()[itemId]
	if (!item || item.children.length) return false
	updateItem(itemId, { done, doneAt: done ? today : '' })
	return true
}

/** Whether an item counts as done: a leaf by its tick, a parent by its rule over its works. */
export function isItemDone(itemId: string, all: Items = items.get(), depth = 0): boolean {
	const item = all[itemId]
	if (!item) return false
	if (!item.children.length || depth > 16) return item.done
	return progressOf(itemId, all, depth).complete
}

export function progressOf(itemId: string, all: Items = items.get(), depth = 0): ChildProgress {
	const item = all[itemId]
	const children = (item?.children ?? []).map((id) => all[id]).filter((c): c is ItemDef => !!c)
	return childProgress(
		children.map((c) => ({ done: isItemDone(c.itemId, all, depth + 1), core: c.core })),
		parseChildRule(item?.childRule ?? 'core')
	)
}

/** The next undone leaf under an item, works in their order; `null` when it is all done. */
export function nextLeafOf(itemId: string, all: Items = items.get(), depth = 0): ItemDef | null {
	const item = all[itemId]
	if (!item || depth > 16) return null
	if (!item.children.length) return item.done ? null : item
	for (const child of item.children) {
		const leaf = nextLeafOf(child, all, depth + 1)
		if (leaf) return leaf
	}
	return null
}

// ---- Tracks

export function putTracks(defs: readonly TrackDef[]): void {
	if (!defs.length) return
	const next: Record<string, TrackDef> = { ...tracks.get() }
	for (const def of defs) next[def.trackId] = def
	tracks.set(next)
}

export function updateTrack(trackId: string, patch: Partial<Omit<TrackDef, 'trackId'>>): void {
	const track = tracks.get()[trackId]
	if (track) tracks.set({ ...tracks.get(), [trackId]: { ...track, ...patch } })
}

const STATES = ['active', 'paused', 'notStarted'] as const

export function cycleTrackState(trackId: string): void {
	const track = tracks.get()[trackId]
	if (!track) return
	const at = STATES.indexOf(track.state as (typeof STATES)[number])
	updateTrack(trackId, { state: STATES[(at + 1) % STATES.length] })
}

/** Moves one entry a place up or down its track. */
export function moveInTrack(trackId: string, itemId: string, delta: -1 | 1): void {
	const track = tracks.get()[trackId]
	if (!track) return
	const order = [...track.order]
	const from = order.indexOf(itemId)
	const to = from + delta
	if (from < 0 || to < 0 || to >= order.length) return
	const [moved] = order.splice(from, 1)
	if (moved !== undefined) order.splice(to, 0, moved)
	updateTrack(trackId, { order })
}

export function removeFromTrack(trackId: string, itemId: string): void {
	const track = tracks.get()[trackId]
	if (track) updateTrack(trackId, { order: track.order.filter((id) => id !== itemId) })
}

/** A new, empty track, active so Up next picks it up. Returns its id. */
export function addTrack(name: string, goal = ''): string {
	const trackId = makeItemId(name.trim() || 'syllabus')
	putTracks([{ trackId, name: name.trim(), goal, state: 'active', order: [], defaultTags: [], draft: '' }])
	return trackId
}

/** A new entry at the end of a track, under the track's goal prefix as an import would put it. Returns its id. */
export function addEntry(trackId: string, title: string): string | null {
	const track = tracks.get()[trackId]
	if (!track || !title.trim()) return null
	const prefix = trackId.includes('/') ? `${trackId.split('/')[0]}/` : ''
	const itemId = makeItemId(title.trim(), prefix)
	putItems([
		{
			itemId,
			title: title.trim(),
			kind: 'Study',
			medium: '',
			tags: [...track.defaultTags],
			core: false,
			childRule: 'core',
			parent: '',
			children: [],
			done: false,
			doneAt: '',
			draft: '',
		},
	])
	updateTrack(trackId, { order: [...track.order, itemId] })
	return itemId
}

/** The entries only this track lists: what removing it takes with it. Another track's entries stay. */
export function entriesOnlyIn(trackId: string): string[] {
	const track = tracks.get()[trackId]
	if (!track) return []
	const elsewhere = new Set(Object.values(tracks.get()).flatMap((t) => (t.trackId === trackId ? [] : t.order)))
	return track.order.filter((id) => !elsewhere.has(id) && !!items.get()[id])
}

/** Takes an entry out of a track, and out of the vault with its works when no other track lists it. */
export function removeEntry(trackId: string, itemId: string): void {
	if (entriesOnlyIn(trackId).includes(itemId)) removeItems([itemId])
	else removeFromTrack(trackId, itemId)
}

/** Removes a track and every entry only it lists, with their works. Ticks on them go too. */
export function removeTrack(trackId: string): void {
	if (!tracks.get()[trackId]) return
	const entries = entriesOnlyIn(trackId)
	const next = { ...tracks.get() }
	delete next[trackId]
	tracks.set(next)
	removeItems(entries)
}

// ---- Drafts

/** Confirms what an import on this board made: it joins the index from here on. */
export function confirmDrafts(boardId: string): number {
	const mine = Object.values(items.get()).filter((i) => i.draft === boardId)
	const mineTracks = Object.values(tracks.get()).filter((t) => t.draft === boardId)
	putItems(mine.map((i) => ({ ...i, draft: '' })))
	putTracks(mineTracks.map((t) => ({ ...t, draft: '' })))
	return mine.length + mineTracks.length
}

/** Removes what an import on this board made and nobody confirmed. */
export function discardDrafts(boardId: string): number {
	const mine = Object.values(items.get()).filter((i) => i.draft === boardId).map((i) => i.itemId)
	const mineTracks = Object.values(tracks.get()).filter((t) => t.draft === boardId)
	removeItems(mine)
	if (mineTracks.length) {
		const next = { ...tracks.get() }
		for (const t of mineTracks) delete next[t.trackId]
		tracks.set(next)
	}
	return mine.length + mineTracks.length
}

export const hasDrafts = (boardId: string): boolean =>
	Object.values(items.get()).some((i) => i.draft === boardId) || Object.values(tracks.get()).some((t) => t.draft === boardId)

// ---- Evidence

/** What one board's notes say, replacing what that board said before. */
export function rescanEvidence(boardId: string, entries: readonly EvidenceEntry[]): void {
	const next: Record<string, EvidenceEntry> = {}
	for (const [key, entry] of Object.entries(evidence.get())) if (entry.boardId !== boardId) next[key] = entry
	for (const entry of entries) next[evidenceKey(entry)] = entry
	evidence.set(next)
}

export function putEvidence(entry: EvidenceEntry): void {
	evidence.set({ ...evidence.get(), [evidenceKey(entry)]: entry })
}

export function removeEvidence(boardId: string, shapeId: string): void {
	const key = evidenceKey({ boardId, shapeId })
	if (!evidence.get()[key]) return
	const next = { ...evidence.get() }
	delete next[key]
	evidence.set(next)
}

// ---- The index: what requirements, habits and Up Next read

/**
 * One item as the evaluators see it: its effective tags (its own and every ancestor's), whether it
 * is done, and whether it counts as evidence (done, a leaf, and a write-up holding something).
 */
export interface IndexEntry {
	itemId: string
	title: string
	kind: string
	medium: string
	tags: string[]
	done: boolean
	doneAt: string
	evidence: boolean
	method: string
	core: boolean
	parentItemId: string
	hasChildren: boolean
	/** Place among its siblings: the order a unit's steps are worked through. */
	position: number
}

export type SkillIndex = Readonly<Record<string, IndexEntry>>

const index = computed<SkillIndex>('lifeboard:syllabus-index', () => buildIndex(items.get(), evidence.get()))

export const getSkillIndex = (): SkillIndex => index.get()

/** Pure, for tests and the computed above. Drafts are left out. */
export function buildIndex(all: Items, notes: Evidence): SkillIndex {
	const written = new Map<string, EvidenceEntry>()
	for (const e of Object.values(notes)) if (e.written || !written.has(e.itemId)) written.set(e.itemId, e)
	const out: Record<string, IndexEntry> = {}
	const tagsOf = (item: ItemDef): string[] => {
		const tags = new Set<string>()
		let current: ItemDef | undefined = item
		for (let depth = 0; current && depth < 16; depth++) {
			for (const t of current.tags) tags.add(t)
			current = current.parent ? all[current.parent] : undefined
		}
		return [...tags]
	}
	for (const item of Object.values(all)) {
		if (item.draft) continue
		const done = isItemDone(item.itemId, all)
		const note = written.get(item.itemId)
		const leaf = item.children.length === 0
		const parent = item.parent ? all[item.parent] : undefined
		out[item.itemId] = {
			itemId: item.itemId,
			title: item.title,
			kind: item.kind,
			medium: item.medium,
			tags: tagsOf(item),
			done,
			doneAt: leaf ? item.doneAt : done ? latestDoneAt(item, all) : '',
			evidence: done && leaf && !!note?.written,
			method: note?.method ?? '',
			core: item.core,
			parentItemId: item.parent,
			hasChildren: !leaf,
			position: parent ? parent.children.indexOf(item.itemId) : 0,
		}
	}
	return out
}

function latestDoneAt(item: ItemDef, all: Items, depth = 0): string {
	if (!item.children.length || depth > 16) return item.doneAt
	return item.children.reduce((latest, id) => {
		const child = all[id]
		const at = child ? latestDoneAt(child, all, depth + 1) : ''
		return at > latest ? at : latest
	}, '')
}
