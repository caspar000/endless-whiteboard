import { atom, type Atom, type Editor } from '@lifeboard/canvas'
import { boxOrder, type BoxEntry } from '../box'
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
}

const states = new WeakMap<Editor, Atom<StackState>>()

function stateOf(editor: Editor): Atom<StackState> {
	let state = states.get(editor)
	if (!state) {
		// A box opens on its stack (docs/zettelkasten-plan.md, Q1).
		state = atom<StackState>('lifeboard:zettel-stack', { open: true, zid: null })
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

export function setStackOpen(editor: Editor, open: boolean): void {
	stateOf(editor).update((state) => ({ ...state, open }))
}

/** Brings a note to the front (and opens the stack if it isn't). */
export function showCard(editor: Editor, zid: string): void {
	stateOf(editor).set({ open: true, zid })
}

/**
 * Where the stack is, as an index into the box's order: the note it was left on, or if that note is
 * gone, the one that now stands in its place.
 */
export function frontIndex(editor: Editor, order: readonly BoxEntry[] = boxOrder(editor)): number {
	if (!order.length) return -1
	const { zid } = stateOf(editor).get()
	if (zid === null) return 0
	const exact = order.findIndex((entry) => entry.zid === zid)
	if (exact >= 0) return exact
	// Deleted: the card behind it has moved up into its place.
	const after = order.findIndex((entry) => compareZids(entry.zid, zid) > 0)
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
