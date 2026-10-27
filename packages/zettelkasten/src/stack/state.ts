import { atom, type Atom, type Editor } from '@lifeboard/canvas'
import { boxOrder, type BoxEntry } from '../box'
import type { Turn } from '../chain'
import { compareZids } from '../ids'

/**
 * What the stack is showing, per board: whether it is open, and which note is in front.
 *
 * Not board data. Two people in one box each flip through it at their own pace, and nothing about
 * looking at a card is worth an undo step, so it lives here rather than in the store. Per editor,
 * because a tab that isn't on screen keeps its editor, and coming back to it should find the same card.
 */
export interface StackState {
	open: boolean
	/** The note in front, by id. `null` is the front of the box. */
	zid: string | null
	/** A keyword picked out on the index, when the index was opened from a note's keyword. */
	keyword: string | null
	/** A source being filled in, by id: its fields are open on the front card. */
	filling: string | null
	/** The chain being followed (chain.ts), drawn over the stack or the table; `null` when there is none. */
	chain: Turn[] | null
	/** Whether the graph (GraphView) is drawn over the stack or the table. Never with a chain. */
	graph: boolean
}

const states = new WeakMap<Editor, Atom<StackState>>()

function stateOf(editor: Editor): Atom<StackState> {
	let state = states.get(editor)
	if (!state) {
		// A box opens on its stack (docs/zettelkasten-plan.md, Q1).
		state = atom<StackState>('lifeboard:zettel-stack', { open: true, zid: null, keyword: null, filling: null, chain: null, graph: false })
		states.set(editor, state)
	}
	return state
}

export function getStack(editor: Editor): StackState {
	return stateOf(editor).get()
}

export function isStackOpen(editor: Editor): boolean {
	return stateOf(editor).get().open
}

/** Shows the stack (`true`) or the table, leaving any chain. */
export function setStackOpen(editor: Editor, open: boolean): void {
	stateOf(editor).update((state) => ({ ...state, open, chain: null, graph: false }))
}

/** Brings a note to the front (and opens the stack if it isn't). */
export function showCard(editor: Editor, zid: string, keyword: string | null = null): void {
	stateOf(editor).set({ open: true, zid, keyword, filling: null, chain: null, graph: false })
}

export function isChainOpen(editor: Editor): boolean {
	return stateOf(editor).get().chain !== null
}

/** Starts following a chain of thought from a note, over whichever view is showing. */
export function openChain(editor: Editor, from: string): void {
	stateOf(editor).update((state) => ({ ...state, filling: null, chain: [{ at: null, to: from }], graph: false }))
}

/** Takes the link to `to` from row `at` of the chain's path. */
export function turnChain(editor: Editor, at: number, to: string): void {
	stateOf(editor).update((state) => (state.chain ? { ...state, chain: [...state.chain, { at, to }] } : state))
}

/** Goes back to the chain as it was after its `index`th turn. */
export function stepChain(editor: Editor, index: number): void {
	stateOf(editor).update((state) =>
		state.chain && index >= 0 ? { ...state, chain: state.chain.slice(0, index + 1) } : state
	)
}

/** Leaves the chain, back to the stack or the table it was opened over. */
export function closeChain(editor: Editor): void {
	stateOf(editor).update((state) => ({ ...state, chain: null }))
}

export function isGraphOpen(editor: Editor): boolean {
	return stateOf(editor).get().graph
}

/** Draws the box as a graph over whichever view is showing, or takes it away. */
export function setGraphOpen(editor: Editor, graph: boolean): void {
	stateOf(editor).update((state) => ({ ...state, filling: null, chain: graph ? null : state.chain, graph }))
}

/**
 * Whether the canvas holds the box's one live copy of each card's text (CardFace): not while the stack
 * or a chain is up, since those edit the cards themselves.
 */
export function isCanvasLive(editor: Editor): boolean {
	const state = stateOf(editor).get()
	return !state.open && state.chain === null
}

/** Opens a source's fields on the front card, or closes them (`null`). */
export function setFilling(editor: Editor, zid: string | null): void {
	stateOf(editor).update((state) => ({ ...state, filling: zid }))
}

/**
 * Where the stack is, as an index into the box's order: the note it was left on, or if that note is
 * gone, the one that now stands in its place.
 */
export function frontIndex(editor: Editor, order: readonly BoxEntry[] = boxOrder(editor)): number {
	if (!order.length) return -1
	const { zid } = stateOf(editor).get()
	// A box opens on its first note, with the index one card before it.
	if (zid === null) return Math.max(0, order.findIndex((entry) => entry.kind !== 'index'))
	const exact = order.findIndex((entry) => entry.zid === zid)
	if (exact >= 0) return exact
	// Deleted: the card behind it has moved up into its place.
	const after = order.findIndex((entry) => entry.kind !== 'index' && compareZids(entry.zid, zid) > 0)
	return after >= 0 ? after : order.length - 1
}

/**
 * What the box has to tell the person, briefly: that a note got a new id because another device used
 * its id first (box.ts, `settleDuplicateIds`). Shown by the stack and the dock, then let go.
 */
export const boxNotice = atom<{ text: string; at: number } | null>('lifeboard:zettel-notice', null)

export function announce(text: string): void {
	boxNotice.set({ text, at: Date.now() })
}
