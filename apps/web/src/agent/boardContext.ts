import { shapeLabel } from '@lifeboard/node-kit'
import { react, type Editor } from 'tldraw'

/**
 * What the agent is told about the board before it is told anything else.
 *
 * Two problems, one answer. The user asked for their selection to reach the chat automatically — "name
 * these" should work without describing which ones — and separately the agent was spending turns
 * *asking* which board was open before it could act. Both are the same shape of waste: the app knows
 * something the model has to make a tool call to learn.
 *
 * So each turn carries a small block of context the app already has. `view.selection` and `board.list`
 * still exist and are still correct; they are now for the cases this cannot cover (a background board,
 * a selection the user changed mid-turn) rather than for the opening move of every conversation.
 *
 * Deliberately *small*. It is prepended to every message, so anything in here is paid for on each
 * turn — ids, types and labels, never property values or text. The agent has `node.find` for the rest,
 * and now knows exactly which ids to ask about.
 */

/** One selected shape, as the model and the composer's chip both see it. */
export interface ContextShape {
	id: string
	type: string
	/** The shape's own words where it has any — a note's title, a caption's text. */
	label: string
}

export interface TurnContext {
	/** The board on screen, or `null` on the home screen. */
	boardId: string | null
	boardName: string | null
	/** Capped at `MAX_CONTEXT_SHAPES`. `selectionTotal` says how many there really were. */
	selection: readonly ContextShape[]
	selectionTotal: number
}

/**
 * How many selected shapes are described before the list is summarised as a count.
 *
 * A rubber-band selection over a whole board can be hundreds of shapes. Listing them all would spend
 * more of the turn's budget on context than on the request — and a model given 300 ids will use
 * `node.find` anyway.
 */
export const MAX_CONTEXT_SHAPES = 12

const EMPTY: TurnContext = { boardId: null, boardName: null, selection: [], selectionTotal: 0 }

let context: TurnContext = EMPTY
const listeners = new Set<() => void>()

/**
 * Whether the next turn carries the selection at all.
 *
 * Dismissing the chip is a per-turn decision, not a preference: it is for "I have something selected
 * but this question is not about it", which is a thing you decide once and not a mode you enter. So
 * sending resets it (see `bridge.ts`).
 */
let dismissed = false

export function getTurnContext(): TurnContext {
	// Stable between changes: `useSyncExternalStore` re-renders forever on a snapshot rebuilt per read.
	return context
}

export function subscribeToTurnContext(listener: () => void): () => void {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

/** The context as it should travel, or `null` when there is nothing worth sending. */
export function getSendableContext(): TurnContext | null {
	// A dismissal drops the selection but keeps the board: "not about these shapes" is not "pretend no
	// board is open", and the board line is what stops the agent opening with `board.list`.
	if (dismissed) {
		return context.boardId ? { ...context, selection: [], selectionTotal: 0 } : null
	}
	return context.boardId || context.selection.length ? context : null
}

export function isSelectionDismissed(): boolean {
	return dismissed
}

export function dismissSelection(): void {
	dismissed = true
	publish(context)
}

/** Called after a turn is sent, and whenever the selection changes — see `dismissed`. */
export function restoreSelection(): void {
	if (!dismissed) return
	dismissed = false
	publish(context)
}

function publish(next: TurnContext): void {
	context = next
	for (const listener of listeners) listener()
}

function same(a: TurnContext, b: TurnContext): boolean {
	return (
		a.boardId === b.boardId &&
		a.boardName === b.boardName &&
		a.selection.length === b.selection.length &&
		a.selection.every((shape, index) => shape.id === b.selection[index]?.id)
	)
}

/** Drops the reactive subscription to whichever editor was being watched. */
let unwatch: (() => void) | null = null

/**
 * Points the store at the board on screen. Called by the app's composition root when the active tab
 * changes, for the same reason the bridge's editor source is: this module must not reach into app
 * state, and the app is the only thing that knows which editor is in front of the user.
 *
 * Passing `null` is the home screen, and clears everything.
 */
export function watchBoard(input: { boardId: string; name: string; editor: Editor } | null): void {
	unwatch?.()
	unwatch = null

	if (!input) {
		publish(EMPTY)
		return
	}

	const { boardId, name, editor } = input

	/**
	 * tldraw's `react` rather than a store listener: selection lives in a signal, so this re-runs on
	 * exactly the changes that matter and never on the hundred unrelated record updates a canvas
	 * produces while somebody is dragging. The label is read inside the reaction too — renaming a
	 * selected note should update the chip.
	 */
	unwatch = react('lb:agent-context', () => {
		const shapes = editor.getSelectedShapes()
		const next: TurnContext = {
			boardId,
			boardName: name,
			selection: shapes.slice(0, MAX_CONTEXT_SHAPES).map((shape) => ({
				id: shape.id,
				type: shape.type,
				label: shapeLabel(editor, shape),
			})),
			selectionTotal: shapes.length,
		}
		// A changed selection is a new question, so a dismissal does not carry over to it.
		if (!same(context, next)) restoreSelection()
		publish(next)
	})
}
