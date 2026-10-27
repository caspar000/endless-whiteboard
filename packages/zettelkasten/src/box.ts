import {
	computed,
	createShapeId,
	toRichText,
	type Computed,
	type Editor,
	type TLRichText,
	type TLShape,
	type TLShapeId,
	type TLShapePartial,
} from '@lifeboard/canvas'
import {
	compareZids,
	isCiteId,
	nextCite,
	nextFreeBranch,
	nextTrain,
	parentOf,
	placeAfterDuplicate,
	placeBehind,
} from './ids'
import { INDEX_ZID, tableLayout } from './layout'
import { keywordKey, linkGraph, tidyKeyword, type LinkGraph } from './links'

export const CARD_TYPE = 'node.zettel'
/** A source the box's notes cite: a book, a paper, a talk (Q7). */
export const SOURCE_TYPE = 'node.zettelSource'
/** The front of the box: its keywords, A to Z, with the notes filed under each (Q6). */
export const INDEX_TYPE = 'node.zettelIndex'
/**
 * The one index card. A fixed id rather than a fresh one, so two devices that each find a box without
 * its index and make one make the same record, and end up with one.
 */
export const INDEX_ID = createShapeId('zettel-index')
export { INDEX_ZID }

/** Where a board says it is a box: the document record's meta, so it travels with the board's content. */
export const BOX_META = 'lifeboard:box'

export interface BoxMeta {
	version: 1
	/** Ids of deleted notes. Never given out again, as a pulled card's number isn't reused. */
	retired: string[]
}

export interface CardProps {
	/** The note's id in its box: `25a1`. Given by where it was placed, never changed (but see `settleDuplicateIds`). */
	zid: string
	/** What the note says, in the sticky note's rich text. A heading as its first line is its title. */
	richText: TLRichText
	/** Index keywords this note is filed under, as typed. */
	keywords: string[]
	/** Notes linked with the card's **+**, by id. Links written in the text (`[[25a]]`) stay in the text. */
	links: string[]
	/** Sources this note cites, by id (`c1`). */
	cites: string[]
}

export interface SourceProps {
	/** `c1`, `c2`…: given in the order sources are added, never reused. */
	zid: string
	author: string
	title: string
	year: string
	/** Anything else worth keeping: the edition, the pages, where it was found. */
	note: string
}

export type CardShape = TLShape & { type: typeof CARD_TYPE; props: CardProps & { w: number; h: number } }
export type SourceShape = TLShape & { type: typeof SOURCE_TYPE; props: SourceProps & { w: number; h: number } }

export function isCard(shape: TLShape | null | undefined): shape is CardShape {
	return shape?.type === CARD_TYPE
}

export function isSource(shape: TLShape | null | undefined): shape is SourceShape {
	return shape?.type === SOURCE_TYPE
}

/** Anything in the box with an id of its own: a note or a source. */
export function isNumbered(shape: TLShape | null | undefined): shape is CardShape | SourceShape {
	return isCard(shape) || isSource(shape)
}

export function readBoxMeta(editor: Editor): BoxMeta | null {
	const value = editor.getDocumentSettings().meta[BOX_META]
	if (!value || typeof value !== 'object') return null
	const retired = (value as { retired?: unknown }).retired
	return { version: 1, retired: Array.isArray(retired) ? retired.filter((id): id is string => typeof id === 'string') : [] }
}

export function isBox(editor: Editor): boolean {
	return readBoxMeta(editor) !== null
}

function writeBoxMeta(editor: Editor, meta: BoxMeta): void {
	editor.updateDocumentSettings({ meta: { ...editor.getDocumentSettings().meta, [BOX_META]: { ...meta } } })
}

/** Makes an empty board a box, with its index. The first note is written from the stack, where the box opens. */
export function makeBox(editor: Editor): void {
	editor.run(
		() => {
			writeBoxMeta(editor, { version: 1, retired: [] })
			ensureIndex(editor)
		},
		{ history: 'ignore' }
	)
}

/**
 * Puts the index card in a box that has none: one made before the index existed, or one whose index
 * was taken out some other way. Not an undo step; nobody made it on purpose.
 */
export function ensureIndex(editor: Editor): void {
	if (editor.getShape(INDEX_ID)) return
	editor.run(
		() => {
			editor.createShape({ id: INDEX_ID, type: INDEX_TYPE, x: 0, y: 0 } as unknown as TLShapePartial)
			layoutBox(editor)
		},
		{ history: 'ignore' }
	)
}

/**
 * One place in the box: the index at the front, a note, a source at the back, or the gap a deleted
 * note left where its branches still hang (`id` `null`), so the box shows where it was, as a pulled
 * card leaves a space in a drawer.
 */
export interface BoxEntry {
	zid: string
	id: TLShapeId | null
	kind: 'index' | 'note' | 'source' | 'gap'
}

const orders = new WeakMap<Editor, Computed<BoxEntry[]>>()

/**
 * The box in order: the index, every note by its id with a gap for each retired id that still has a
 * note under it, then the sources. Cached per editor and recomputed only when a card or the box's meta
 * changes, so the stack can ask on every frame.
 */
export function boxOrder(editor: Editor): BoxEntry[] {
	let order = orders.get(editor)
	if (!order) {
		order = computed('lifeboard:zettel-order', () => {
			const shapes = editor.getCurrentPageShapes()
			const entries: BoxEntry[] = []
			for (const shape of shapes) {
				if (isCard(shape)) entries.push({ zid: shape.props.zid, id: shape.id, kind: 'note' })
				else if (isSource(shape)) entries.push({ zid: shape.props.zid, id: shape.id, kind: 'source' })
			}
			const live = new Set(entries.map((entry) => entry.zid))
			for (const zid of readBoxMeta(editor)?.retired ?? []) {
				if (live.has(zid)) continue
				const hasBranches = entries.some((entry) => isUnder(entry.zid, zid))
				if (hasBranches) entries.push({ zid, id: null, kind: 'gap' })
			}
			entries.sort((a, b) => compareZids(a.zid, b.zid) || (a.id ?? '').localeCompare(b.id ?? ''))
			if (shapes.some((shape) => shape.id === INDEX_ID)) entries.unshift({ zid: INDEX_ZID, id: INDEX_ID, kind: 'index' })
			return entries
		})
		orders.set(editor, order)
	}
	return order.get()
}

/** Whether the box has anything written in it yet: a note or a source. The index alone doesn't count. */
export function hasWriting(order: readonly BoxEntry[]): boolean {
	return order.some((entry) => entry.kind !== 'index')
}

const graphs = new WeakMap<Editor, Computed<LinkGraph>>()

/** The box's links, citations and index (links.ts), cached per editor like the order. */
export function boxLinks(editor: Editor): LinkGraph {
	let graph = graphs.get(editor)
	if (!graph) {
		graph = computed('lifeboard:zettel-links', () =>
			linkGraph(
				editor
					.getCurrentPageShapes()
					.filter(isCard)
					.map((card) => ({
						zid: card.props.zid,
						richText: card.props.richText,
						links: card.props.links ?? [],
						keywords: card.props.keywords ?? [],
						cites: card.props.cites ?? [],
					}))
			)
		)
		graphs.set(editor, graph)
	}
	return graph.get()
}

function isUnder(zid: string, ancestor: string): boolean {
	for (let parent = parentOf(zid); parent; parent = parentOf(parent)) if (parent === ancestor) return true
	return false
}

/** Every id anybody has had in this box: on a card now, or retired. */
export function takenIds(editor: Editor): Set<string> {
	const taken = new Set(boxOrder(editor).map((entry) => entry.zid))
	for (const zid of readBoxMeta(editor)?.retired ?? []) taken.add(zid)
	return taken
}

export function cardByZid(editor: Editor, zid: string): CardShape | undefined {
	const shape = shapeByZid(editor, zid)
	return isCard(shape) ? shape : undefined
}

/** The note or source with this id, if the box has one. */
export function shapeByZid(editor: Editor, zid: string): CardShape | SourceShape | undefined {
	const entry = boxOrder(editor).find((e) => e.zid === zid && e.id && e.kind !== 'index')
	const shape = entry?.id ? editor.getShape(entry.id) : undefined
	return isNumbered(shape) ? shape : undefined
}

export type Placement = 'behind' | 'branch' | 'train'

/** The id a new note would get, placed from `from` (the card in front). */
export function idForPlacement(editor: Editor, how: Placement, from: string | null): string {
	const taken = takenIds(editor)
	if (how === 'train' || !from) return nextTrain(taken)
	return how === 'branch' ? nextFreeBranch(from, taken) : placeBehind(from, taken)
}

/**
 * Writes a new, empty note into the box where `how` says, and lays the box out again. One undo step.
 * Returns the new card's id.
 */
export function placeNote(editor: Editor, how: Placement, from: string | null): { id: TLShapeId; zid: string } {
	const zid = idForPlacement(editor, how, from)
	const id = createShapeId()
	editor.markHistoryStoppingPoint('write a note')
	editor.run(() => {
		editor.createShape({
			id,
			type: CARD_TYPE,
			x: 0,
			y: 0,
			props: { zid, richText: toRichText(''), keywords: [], links: [], cites: [] },
		} as unknown as TLShapePartial)
		layoutBox(editor)
	})
	return { id, zid }
}

/** Adds a source at the back of the box, numbered after every source it has had. One undo step. */
export function placeSource(editor: Editor, fields: Partial<Omit<SourceProps, 'zid'>> = {}): { id: TLShapeId; zid: string } {
	const zid = nextCite(takenIds(editor))
	const id = createShapeId()
	editor.markHistoryStoppingPoint('add a source')
	editor.run(() => {
		editor.createShape({
			id,
			type: SOURCE_TYPE,
			x: 0,
			y: 0,
			props: { zid, author: '', title: '', year: '', note: '', ...fields },
		} as unknown as TLShapePartial)
		layoutBox(editor)
	})
	return { id, zid }
}

export type ChipKind = 'link' | 'keyword' | 'cite'

const CHIP_PROP = { link: 'links', keyword: 'keywords', cite: 'cites' } as const

/**
 * Adds a link, keyword or citation to a note's footer. A keyword already there in another case isn't
 * added twice. One undo step.
 */
export function addChip(editor: Editor, id: TLShapeId, kind: ChipKind, value: string): void {
	const card = editor.getShape(id)
	if (!isCard(card)) return
	const prop = CHIP_PROP[kind]
	const list = card.props[prop] ?? []
	const tidy = kind === 'keyword' ? tidyKeyword(value) : value.trim().toLowerCase()
	if (!tidy) return
	const same = (other: string) => (kind === 'keyword' ? keywordKey(other) === keywordKey(tidy) : other === tidy)
	if (list.some(same)) return
	editor.markHistoryStoppingPoint(`add a ${kind}`)
	editor.updateShape({ id, type: CARD_TYPE, props: { [prop]: [...list, tidy] } } as unknown as TLShapePartial)
}

/** Takes a link, keyword or citation off a note's footer. One undo step. */
export function removeChip(editor: Editor, id: TLShapeId, kind: ChipKind, value: string): void {
	const card = editor.getShape(id)
	if (!isCard(card)) return
	const prop = CHIP_PROP[kind]
	const list = card.props[prop] ?? []
	if (!list.includes(value)) return
	editor.markHistoryStoppingPoint(`remove a ${kind}`)
	editor.updateShape({
		id,
		type: CARD_TYPE,
		props: { [prop]: list.filter((other) => other !== value) },
	} as unknown as TLShapePartial)
}

/** Writes some of a source's fields. */
export function updateSource(editor: Editor, id: TLShapeId, fields: Partial<Omit<SourceProps, 'zid'>>): void {
	const source = editor.getShape(id)
	if (!isSource(source)) return
	editor.updateShape({ id, type: SOURCE_TYPE, props: fields } as unknown as TLShapePartial)
}

/** Puts an id on the retired list, if it isn't there yet. */
export function retireId(editor: Editor, zid: string): void {
	const meta = readBoxMeta(editor) ?? { version: 1 as const, retired: [] }
	if (!meta.retired.includes(zid)) writeBoxMeta(editor, { ...meta, retired: [...meta.retired, zid] })
}

/**
 * Takes a note out of the box. Its id is retired for good; its branches stay where they are.
 *
 * ⌘Z brings the card back but leaves its id on the retired list, since the board's history undoes shape
 * changes and not the document record. That errs the safe way: the id is in use again, and still never
 * given to a different note.
 */
export function deleteNote(editor: Editor, id: TLShapeId): void {
	const card = editor.getShape(id)
	if (!isNumbered(card)) return
	editor.markHistoryStoppingPoint('delete a note')
	editor.run(() => {
		retireId(editor, card.props.zid)
		editor.deleteShapes([id])
		layoutBox(editor)
	})
}

/**
 * Stands every card where the table layout says (layout.ts). Writes only the cards that moved, so a
 * box already in place costs nothing; placing a note moves the cards below it down their column.
 */
export function layoutBox(editor: Editor): void {
	const cards = boxOrder(editor).filter((entry) => entry.id)
	const positions = tableLayout(cards.map((entry) => entry.zid))
	const moves: TLShapePartial[] = []
	for (const entry of cards) {
		const shape = editor.getShape(entry.id!)
		const at = positions.get(entry.zid)
		if (!shape || !at || (shape.x === at.x && shape.y === at.y)) continue
		moves.push({ id: shape.id, type: shape.type, x: at.x, y: at.y } as TLShapePartial)
	}
	if (moves.length) editor.updateShapes(moves)
}

/**
 * Two cards with one id: two devices both placed a note at the same spot while apart. The card with
 * the later shape id moves straight behind the other (`placeAfterDuplicate`). Every device decides the
 * same way from the same records, so they converge whichever sees the clash first. Returns what moved,
 * for telling the person.
 *
 * Not an undo step: nobody here did it, and ⌘Z must not hand the clash back.
 */
export function settleDuplicateIds(editor: Editor): { from: string; to: string }[] {
	const byZid = new Map<string, (CardShape | SourceShape)[]>()
	for (const card of editor.getCurrentPageShapes().filter(isNumbered)) {
		const list = byZid.get(card.props.zid) ?? []
		list.push(card)
		byZid.set(card.props.zid, list)
	}
	const moved: { from: string; to: string }[] = []
	const clashes = [...byZid.values()].filter((list) => list.length > 1)
	if (!clashes.length) return moved
	editor.run(
		() => {
			const taken = takenIds(editor)
			for (const list of clashes) {
				const [, ...later] = list.sort((a, b) => a.id.localeCompare(b.id))
				for (const card of later) {
					const to = isCiteId(card.props.zid) ? nextCite(taken) : placeAfterDuplicate(card.props.zid, taken)
					taken.add(to)
					editor.updateShape({ id: card.id, type: card.type, props: { zid: to } } as TLShapePartial)
					moved.push({ from: card.props.zid, to })
				}
			}
			layoutBox(editor)
		},
		{ history: 'ignore' }
	)
	return moved
}
