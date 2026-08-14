import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import type { PropertyDef } from '../properties/types'
import { expressionBodyAt, expressionSuggestions, type Suggestion } from './suggest'
import { SuggestMenu, stepSelection } from './suggestMenu'

/**
 * The `{…}` helper for every text editor tldraw owns — stickies, text shapes, shape labels, arrow
 * labels.
 *
 * Written against ProseMirror directly rather than `@tiptap/suggestion`. That package pins its peers
 * to an exact `@tiptap/pm` version while tldraw asks for a range, and two copies of `@tiptap/pm`
 * means two ProseMirror instances — under which plugins fail *silently* rather than loudly. The
 * plugin below is the part of that package we actually need, and it removes the hazard entirely.
 *
 * The rules live in `suggest.ts`, shared with the note's CodeMirror helper, so the two menus cannot
 * drift. All this does is translate positions and dispatch inserts.
 *
 * One thing falls out nicely from deriving the menu state from the selection on every transaction:
 * "re-open for the next step" needs no code. Insert `sum ` and the body is still an unclosed
 * expression, so the menu simply stays open with what comes next; insert a terminal word and the
 * caret lands past the brace, so it closes.
 */

const KEY = new PluginKey<MenuState>('lifeboard:expression-suggest')

interface MenuState {
	/** Absolute document positions of the word being typed. */
	from: number
	to: number
	items: Suggestion[]
	selected: number
	/**
	 * Escape was pressed while inside this expression.
	 *
	 * Kept in the state rather than closing outright, because the caret is still in an open `{…}` and
	 * the menu would reappear on the next keystroke. Reset for free by leaving the expression: the
	 * whole state goes null there, so there is nothing to remember.
	 */
	dismissed: boolean
}

/** What a transaction can say to this plugin, when the document alone does not carry it. */
type MenuMeta = { type: 'dismiss' } | { type: 'select'; selected: number }

/** The menu state implied by wherever the caret is, or `null` for "no menu". */
function stateFor(state: EditorState, properties: readonly PropertyDef[]): MenuState | null {
	const { empty, $from } = state.selection
	// A menu over a range would have to guess which end is being typed at.
	if (!empty) return null
	if (!$from.parent.isTextblock) return null

	const line = $from.parent.textBetween(0, $from.parentOffset, '\n', '\n')
	const found = expressionBodyAt(line, line.length)
	if (!found) return null
	const result = expressionSuggestions(found.body, properties)
	if (!result || result.items.length === 0) return null

	const wordStart = $from.start() + found.start + result.from
	return { from: wordStart, to: $from.pos, items: result.items, selected: 0, dismissed: false }
}

const EXPRESSION_RE = /\{[^{}\n]*\}/g

/** A tint over every complete `{…}`, so a finished expression reads as one object. */
function expressionDecorations(state: EditorState): DecorationSet {
	const found: Decoration[] = []
	state.doc.descendants((node, pos) => {
		if (!node.isTextblock) return true
		const text = node.textBetween(0, node.content.size, '\n', '\n')
		for (const match of text.matchAll(EXPRESSION_RE)) {
			const start = pos + 1 + match.index
			found.push(Decoration.inline(start, start + match[0].length, { class: 'lb-expr-token' }))
		}
		return false
	})
	return DecorationSet.create(state.doc, found)
}

function accept(
	view: EditorView,
	menu: MenuState,
	item: Suggestion,
	onContinue: (caret: number) => void
): void {
	const { state } = view
	if (!item.terminal) {
		const caret = menu.from + item.insert.length
		view.dispatch(state.tr.insertText(item.insert, menu.from, menu.to))
		onContinue(caret)
		return
	}
	// The closing brace is already there — typing `{` wrote it — so this steps past rather than
	// adding a second one.
	const after = state.doc.textBetween(menu.to, Math.min(menu.to + 1, state.doc.content.size))
	const insert = after === '}' ? item.insert : `${item.insert}}`
	const tr = state.tr.insertText(insert, menu.from, menu.to)
	// Landing *past* the brace is what closes the menu: the caret is no longer inside an open
	// expression, so the state recomputes to null on its own.
	tr.setSelection(TextSelection.near(tr.doc.resolve(menu.from + insert.length + 1)))
	view.dispatch(tr.scrollIntoView())
}

/**
 * @param properties Read lazily — the board's registry changes while a shape is open, and a property
 *   invented in a panel should be offered here without leaving edit mode.
 */
export function expressionSuggestExtension(properties: () => readonly PropertyDef[]) {
	/*
	 * tldraw mirrors each rich-text edit through the shape store and may replace the TipTap view in
	 * the process. Remember a non-terminal acceptance outside the individual ProseMirror plugin view,
	 * so the replacement can put the caret back inside the expression and keep the advanced menu open.
	 * The closing brace validates the position, and the short lifetime prevents an old edit from being
	 * resumed if a genuinely new editor appears later.
	 */
	let resume: { caret: number; until: number } | null = null
	/** Remember a caret that belongs *inside* an open `{…}`, for `restore` to put back. */
	const armRestore = (caret: number) => {
		resume = { caret, until: performance.now() + 500 }
	}
	const pick = (view: EditorView, menu: MenuState, item: Suggestion) => {
		if (item.terminal) resume = null
		accept(view, menu, item, armRestore)
	}
	const restore = (view: EditorView) => {
		if (!resume) return
		if (performance.now() > resume.until) {
			resume = null
			return
		}
		const { caret } = resume
		if (!view.dom.isConnected || caret > view.state.doc.content.size) return
		if (view.state.doc.textBetween(caret, Math.min(caret + 1, view.state.doc.content.size)) !== '}') {
			return
		}
		/*
		 * Deliberately *not* disarmed once the caret looks right. At the moment of arming it already
		 * does — this code set it — and the displacement it exists to undo arrives later, on tldraw's
		 * schedule. Disarming on "looks correct" throws the rescue away before the thing it rescues
		 * from has happened, which puts the menu back to closing on the very first `{` (measured:
		 * every run). The deadline is what ends an arming; nothing else can tell the two states apart.
		 */
		if (!KEY.getState(view.state)) {
			view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(caret))))
		}
		view.focus()
	}

	return Extension.create({
		name: 'lifeboardExpressionSuggest',
		addProseMirrorPlugins() {
			return [
				new Plugin<MenuState | null>({
					key: KEY,
					state: {
						init: (_config, state) => stateFor(state, properties()),
						/*
						 * Recomputed from the document every time rather than tracked.
						 *
						 * There is one source of truth about where the caret is and what is around it, and
						 * a menu that kept its own copy would be a second one to hold in step. Only the two
						 * things the document cannot say — which row is highlighted, and whether Escape was
						 * pressed — are carried across, and both are dropped the moment the caret leaves.
						 */
						apply: (tr, prev, _oldState, newState) => {
							const next = stateFor(newState, properties())
							if (!next) return null
							const meta = tr.getMeta(KEY) as MenuMeta | undefined
							if (meta?.type === 'dismiss') return { ...next, dismissed: true }

							// Same word still being typed: keep the highlighted row, so arrowing down and
							// then typing another letter does not silently jump back to the top.
							const same = prev !== null && prev.from === next.from
							const selected =
								meta?.type === 'select'
									? meta.selected
									: same
										? Math.min(prev.selected, next.items.length - 1)
										: 0
							return { ...next, selected, dismissed: same ? prev.dismissed : false }
						},
					},
					props: {
						decorations: (state) => expressionDecorations(state),
						handleTextInput: (view, from, to, text) => {
							if (text !== '{') return false
							// Writing the closer means the menu always has a complete expression to sit in,
							// and `{` is the only key anyone has to know.
							const tr = view.state.tr.insertText('{}', from, to)
							tr.setSelection(TextSelection.near(tr.doc.resolve(from + 1)))
							view.dispatch(tr)
							/*
							 * Opening an expression needs the same rescue as accepting a suggestion, and for the
							 * same reason: tldraw mirrors the edit through the shape store and puts the caret
							 * back at the *end* of the text — one character past the brace just written, where
							 * there is no open expression, so the menu closes the instant it appeared. Without
							 * this the first `{` flashed a menu and lost it, and every later step was
							 * unreachable because the plugin no longer had a menu to act on.
							 */
							armRestore(from + 1)
							return true
						},
						handleKeyDown: (view, event) => {
							const menu = KEY.getState(view.state)
							// Closed already: every key belongs to the editor, and Escape in particular has
							// to reach tldraw or there would be no way out of the shape.
							if (!menu || menu.dismissed) return false
							if (event.key === 'Escape') {
								view.dispatch(view.state.tr.setMeta(KEY, { type: 'dismiss' } as MenuMeta))
								return true
							}
							if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
								const delta = event.key === 'ArrowDown' ? 1 : -1
								const selected = stepSelection(menu.selected, delta, menu.items.length)
								view.dispatch(
									view.state.tr.setMeta(KEY, { type: 'select', selected } as MenuMeta)
								)
								return true
							}
							if (event.key === 'Enter' || event.key === 'Tab') {
								const item = menu.items[menu.selected]
								if (!item) return false
								pick(view, menu, item)
								return true
							}
							return false
						},
					},
					view: (view) => {
						/*
						 * The last state we *drew*, which is what a click has to be answered from.
						 *
						 * Clicking blurs the editor however hard the pointer handler tries to prevent it,
						 * and a blurred ProseMirror reports no selection — so asking it where the
						 * expression was, at click time, asks the wrong moment and the menu shut itself
						 * mid-sequence. This is by definition the state the person was looking at.
						 */
						let drawn: MenuState | null = null
						const menuView = new SuggestMenu((item) => {
							view.focus()
							if (drawn) pick(view, drawn, item)
						})
						const paint = (state: EditorState) => {
							const menu = KEY.getState(state)
							drawn = menu && !menu.dismissed ? menu : null
							const rect = drawn ? view.coordsAtPos(drawn.to) : null
							menuView.render(
								drawn && rect
									? { items: drawn.items, selected: drawn.selected, caret: rect }
									: null
							)
						}
						paint(view.state)
						requestAnimationFrame(() => restore(view))
						return {
							update: (updated) => {
								paint(updated.state)
								requestAnimationFrame(() => restore(updated))
							},
							destroy: () => menuView.destroy(),
						}
					},
				}),
			]
		},
	})
}
