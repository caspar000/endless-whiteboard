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
import { compareZids, nextTrain, parentOf, placeAfterDuplicate, placeBehind, nextFreeBranch } from './ids'
import { tableLayout } from './layout'

export const CARD_TYPE = 'node.zettel'

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
}

export type CardShape = TLShape & { type: typeof CARD_TYPE; props: CardProps & { w: number; h: number } }

export function isCard(shape: TLShape | null | undefined): shape is CardShape {
	return shape?.type === CARD_TYPE
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

/** Makes an empty board a box. The first note is written from the stack, where the box opens. */
export function makeBox(editor: Editor): void {
	editor.run(() => writeBoxMeta(editor, { version: 1, retired: [] }), { history: 'ignore' })
}

/**
 * One place in the box: a card, or the gap a deleted note left where its branches still hang (`id`
 * `null`), so the box shows where it was, as a pulled card leaves a space in a drawer.
 */
export interface BoxEntry {
	zid: string
	id: TLShapeId | null
}

const orders = new WeakMap<Editor, Computed<BoxEntry[]>>()

/**
 * The box in order: every card by its id, with a gap for each retired id that still has a card
 * under it. Cached per editor and recomputed only when a card or the box's meta changes, so the
 * stack can ask on every frame.
 */
export function boxOrder(editor: Editor): BoxEntry[] {
	let order = orders.get(editor)
	if (!order) {
		order = computed('lifeboard:zettel-order', () => {
			const cards = editor.getCurrentPageShapes().filter(isCard)
			const entries: BoxEntry[] = cards.map((card) => ({ zid: card.props.zid, id: card.id }))
			const live = new Set(entries.map((entry) => entry.zid))
			for (const zid of readBoxMeta(editor)?.retired ?? []) {
				if (live.has(zid)) continue
				const hasBranches = entries.some((entry) => isUnder(entry.zid, zid))
				if (hasBranches) entries.push({ zid, id: null })
			}
			return entries.sort((a, b) => compareZids(a.zid, b.zid) || (a.id ?? '').localeCompare(b.id ?? ''))
		})
		orders.set(editor, order)
	}
	return order.get()
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
	const entry = boxOrder(editor).find((e) => e.zid === zid && e.id)
	const shape = entry?.id ? editor.getShape(entry.id) : undefined
	return isCard(shape) ? shape : undefined
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
			props: { zid, richText: toRichText('') },
		} as unknown as TLShapePartial)
		layoutBox(editor)
	})
	return { id, zid }
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
	if (!isCard(card)) return
	editor.markHistoryStoppingPoint('delete a note')
	editor.run(() => {
		const meta = readBoxMeta(editor) ?? { version: 1 as const, retired: [] }
		if (!meta.retired.includes(card.props.zid)) writeBoxMeta(editor, { ...meta, retired: [...meta.retired, card.props.zid] })
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
	const byZid = new Map<string, CardShape[]>()
	for (const card of editor.getCurrentPageShapes().filter(isCard)) {
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
					const to = placeAfterDuplicate(card.props.zid, taken)
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
