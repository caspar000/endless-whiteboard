import type { Editor } from 'tldraw'

/**
 * How much of the board's wiring is drawn — a property of the *board*, not of any relation on it.
 *
 * Hiding relations one at a time (`relations.ts`) answers "this particular arrow is noise". This
 * answers the other half: "right now I want to see the wiring" or "right now I want the board to
 * look like a board". Three states rather than two, because a plain on/off leaves a hidden relation
 * with no way back — you would have to remember where you put it. **All** is the rescue: it draws
 * every relation, hidden ones included and still dashed, so you can find the one you want and change
 * it.
 *
 *  - `all`    — everything, hidden relations revealed as dashed.
 *  - `normal` — each relation's own setting is respected. The default.
 *  - `none`   — no relations at all. The board as it would look with nothing wired.
 *
 * Only *relations* obey this. An arrow with a loose end is a drawing, and a view that made someone's
 * sketch disappear would be a bug, not a feature — so the check is on the bindings, not the shape
 * type (see the app's `relationVisibility.ts`).
 *
 * Stored per board, in the document record's meta, exactly where the property registry lives
 * (`properties/schema.ts`). A board thick with structure and a board of loose notes want different
 * answers, and answering per board is also what makes the setting survive a reload and reach a second
 * tab on its own.
 */

export const RELATION_VIEWS = ['none', 'normal', 'all'] as const
export type RelationView = (typeof RELATION_VIEWS)[number]

/** The default, and what an unreadable stored value falls back to. */
export const DEFAULT_RELATION_VIEW: RelationView = 'normal'

export const RELATION_VIEW_META = 'lifeboard:relationView'

export const RELATION_VIEW_LABELS: Record<RelationView, string> = {
	none: 'No relations',
	normal: 'Relations as set',
	all: 'All relations',
}

/** What each state does, for a tooltip or a palette row — the labels alone don't explain `all`. */
export const RELATION_VIEW_NOTES: Record<RelationView, string> = {
	none: 'No arrows are drawn. Everything they feed still adds up.',
	normal: 'Hidden relations stay hidden; the rest are drawn.',
	all: 'Every relation is drawn, hidden ones dashed — how to find one you hid.',
}

/**
 * The one rule for whether a relation is drawn, so the renderer, the tests and any later reader
 * cannot each decide it slightly differently.
 *
 * Precedence is deliberate: tracing wins over everything, because the point of pointing at a node is
 * to see what it is connected to — a lens that obeyed a "none" you had set five minutes ago would
 * simply appear broken. Then the board's view, then the relation's own setting.
 *
 * `traced` is Phase 4's input and is `false` everywhere until the lens exists. It is a parameter now
 * rather than later because the alternative is writing this rule twice and getting the precedence
 * wrong the second time.
 */
export function isRelationDrawn(view: RelationView, hidden: boolean, traced: boolean): boolean {
	if (traced) return true
	if (view === 'none') return false
	if (view === 'all') return true
	return !hidden
}

/**
 * The next state when the control is clicked, ordered by how much is shown so the cycle is
 * explicable: none → normal → all, and round again. `RELATION_VIEWS` is in that order on purpose.
 */
export function nextRelationView(view: RelationView): RelationView {
	const index = RELATION_VIEWS.indexOf(view)
	return RELATION_VIEWS[(index + 1) % RELATION_VIEWS.length]!
}

/** Whatever was stored, made safe. One bad value costs that value, never the board. */
export function parseRelationView(raw: unknown): RelationView {
	return RELATION_VIEWS.includes(raw as RelationView) ? (raw as RelationView) : DEFAULT_RELATION_VIEW
}

export function readRelationView(editor: Editor): RelationView {
	return parseRelationView(editor.getDocumentSettings().meta[RELATION_VIEW_META])
}

/**
 * `history: 'ignore'` is the point of this function.
 *
 * Changing what you are looking at is not an edit to the board, and a view toggle on the undo stack
 * is worse than untidy: you hide the wiring, notice a typo, press ⌘Z — and get the arrows back
 * instead of the typo. Undo has to stay pointed at the document.
 */
/** Read, step, write — the whole gesture, so its two callers cannot implement it differently. */
export function cycleRelationView(editor: Editor): RelationView {
	const next = nextRelationView(readRelationView(editor))
	setRelationView(editor, next)
	return next
}

export function setRelationView(editor: Editor, view: RelationView): void {
	editor.run(
		() => {
			editor.updateDocumentSettings({
				meta: { ...editor.getDocumentSettings().meta, [RELATION_VIEW_META]: view },
			})
		},
		{ history: 'ignore' }
	)
}
