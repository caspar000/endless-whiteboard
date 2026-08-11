import { Prec, RangeSetBuilder, type Extension } from '@codemirror/state'
import {
	Decoration,
	EditorView,
	ViewPlugin,
	keymap,
	type DecorationSet,
	type ViewUpdate,
} from '@codemirror/view'
import type { PropertyDef } from '../properties/types'
import { expressionBodyAt, expressionSuggestions, type Suggestion } from './suggest'
import { SuggestMenu, stepSelection } from './suggestMenu'

/**
 * The `{…}` helper for the note's CodeMirror editor.
 *
 * Deliberately **not** `@codemirror/autocomplete`. That widget is perfectly good, and it is not the
 * one every other shape on the board uses — different DOM, different key handling, different
 * filtering — so the note's menu felt subtly unlike the sticky's however closely the two were styled.
 * Both now render `SuggestMenu` and ask `suggest.ts`, so they are the same menu rather than two menus
 * that agree.
 *
 * What is left here is the adapter: find the expression under the caret, turn offsets into document
 * positions, dispatch the insert.
 */

interface MenuState {
	/** Document positions of the word being typed. */
	from: number
	to: number
	items: Suggestion[]
	selected: number
	dismissed: boolean
}

/** The menu implied by wherever the caret is, or `null` for "no menu". */
function stateFor(view: EditorView, properties: readonly PropertyDef[]): MenuState | null {
	const { main } = view.state.selection
	// A menu over a range would have to guess which end is being typed at.
	if (!main.empty) return null
	const line = view.state.doc.lineAt(main.head)
	const found = expressionBodyAt(line.text, main.head - line.from)
	if (!found) return null
	const result = expressionSuggestions(found.body, properties)
	if (!result || result.items.length === 0) return null
	return {
		from: line.from + found.start + result.from,
		to: main.head,
		items: result.items,
		selected: 0,
		dismissed: false,
	}
}

function accept(view: EditorView, menu: MenuState, item: Suggestion): void {
	// The closing brace is already there — typing `{` wrote it — so a terminal step writes past it
	// rather than adding a second one, and lands the caret outside the expression. That is what closes
	// the menu: the next recompute finds no open brace.
	const closed = view.state.doc.sliceString(menu.to, menu.to + 1) === '}'
	const insert = item.terminal && !closed ? `${item.insert}}` : item.insert
	view.dispatch({
		changes: { from: menu.from, to: menu.to, insert },
		selection: { anchor: menu.from + item.insert.length + (item.terminal ? 1 : 0) },
		userEvent: 'input.complete',
	})
	view.focus()
}

/** A tint over every complete `{…}`, so a finished expression reads as one object. */
const EXPRESSION_MARK = Decoration.mark({ class: 'lb-expr-token' })

function decorate(view: EditorView): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>()
	// Visible ranges only: a long note should not pay for decorating what is scrolled off.
	for (const { from, to } of view.visibleRanges) {
		const text = view.state.doc.sliceString(from, to)
		for (const match of text.matchAll(/\{[^{}\n]*\}/g)) {
			builder.add(from + match.index, from + match.index + match[0].length, EXPRESSION_MARK)
		}
	}
	return builder.finish()
}

/**
 * @param properties Read lazily — the board's registry changes while a note is open, and a property
 *   invented in another shape's panel should be offered here without reopening the editor.
 */
export function expressionHelper(properties: () => readonly PropertyDef[]): Extension {
	/*
	 * One editor's worth of state, held by the closure.
	 *
	 * `expressionHelper()` is called once per note editor, so this is per-instance despite looking
	 * global — the same shape as the ProseMirror plugin's state, kept here rather than in a
	 * `StateField` because the menu is view furniture and never belongs in the document's history.
	 */
	let current: MenuState | null = null
	let menu: SuggestMenu | null = null
	let repaint = () => {}

	const plugin = ViewPlugin.fromClass(
		class {
			constructor(private readonly view: EditorView) {
				menu = new SuggestMenu((item) => {
					// Answered from what was on screen, not from the editor: the click has already
					// blurred it, and a blurred editor's caret is not where the person was looking.
					if (current) accept(this.view, current, item)
				})
				repaint = () => this.paint()
				this.sync()
			}
			update(update: ViewUpdate) {
				if (update.docChanged || update.selectionSet || update.viewportChanged) this.sync()
			}
			sync() {
				const next = stateFor(this.view, properties())
				// Escape sticks while the caret stays in the same expression, and resets by leaving:
				// `next` is null there, so there is nothing to remember.
				const same = current !== null && next !== null && current.from === next.from
				current = next
					? {
							...next,
							selected: same ? Math.min(current!.selected, next.items.length - 1) : 0,
							dismissed: same ? current!.dismissed : false,
						}
					: null
				this.paint()
			}
			/*
			 * Positioning needs the caret's rectangle, and reading layout is forbidden while CodeMirror
			 * is updating — it throws, the plugin is torn down, and the menu never appears again for
			 * that editor. `requestMeasure` is the sanctioned way to ask: read in the measure phase,
			 * write in the one after it.
			 */
			paint() {
				if (!menu) return
				const state = current && !current.dismissed ? current : null
				if (!state) {
					menu.render(null)
					return
				}
				this.view.requestMeasure({
					key: this,
					read: (view) => view.coordsAtPos(state.to),
					write: (rect) => {
						if (rect && menu) {
							menu.render({ items: state.items, selected: state.selected, caret: rect })
						}
					},
				})
			}
			destroy() {
				menu?.destroy()
				menu = null
				current = null
				repaint = () => {}
			}
		}
	)

	const highlight = ViewPlugin.fromClass(
		class {
			decorations: DecorationSet
			constructor(view: EditorView) {
				this.decorations = decorate(view)
			}
			update(update: ViewUpdate) {
				if (update.docChanged || update.viewportChanged) this.decorations = decorate(update.view)
			}
		},
		{ decorations: (value) => value.decorations }
	)

	/** Every binding refuses when the menu is closed, so nothing the note needs is ever stolen. */
	const whenOpen = (run: (view: EditorView, menu: MenuState) => boolean) => (view: EditorView) =>
		current && !current.dismissed ? run(view, current) : false

	return [
		// Opening a brace writes the closing one, so the menu has a complete expression to sit inside
		// and `{` is the only key anyone has to know.
		EditorView.inputHandler.of((view, from, to, text) => {
			if (text !== '{') return false
			view.dispatch({
				changes: { from, to, insert: '{}' },
				selection: { anchor: from + 1 },
				userEvent: 'input.type',
			})
			return true
		}),
		plugin,
		highlight,
		// Highest, so the menu claims Enter and the arrows ahead of the note's own list handling, and
		// Escape ahead of the binding that leaves the shape.
		Prec.highest(
			keymap.of([
				{
					key: 'ArrowDown',
					run: whenOpen((_view, state) => {
						current = { ...state, selected: stepSelection(state.selected, 1, state.items.length) }
						repaint()
						return true
					}),
				},
				{
					key: 'ArrowUp',
					run: whenOpen((_view, state) => {
						current = { ...state, selected: stepSelection(state.selected, -1, state.items.length) }
						repaint()
						return true
					}),
				},
				{
					key: 'Escape',
					run: whenOpen((_view, state) => {
						current = { ...state, dismissed: true }
						repaint()
						return true
					}),
				},
				{
					key: 'Enter',
					run: whenOpen((view, state) => {
						const item = state.items[state.selected]
						if (!item) return false
						accept(view, state, item)
						return true
					}),
				},
				{
					key: 'Tab',
					run: whenOpen((view, state) => {
						const item = state.items[state.selected]
						if (!item) return false
						accept(view, state, item)
						return true
					}),
				},
			])
		),
	]
}
