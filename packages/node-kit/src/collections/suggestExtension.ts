import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import type { PropertyDef } from '../properties/types'
import { expressionBodyAt, expressionSuggestions, type Suggestion } from './suggest'

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

function accept(view: EditorView, menu: MenuState, item: Suggestion): void {
	const { state } = view
	if (!item.terminal) {
		view.dispatch(state.tr.insertText(item.insert, menu.from, menu.to))
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
 * The popup, as plain DOM in the body.
 *
 * Not a React portal: this lives inside a ProseMirror plugin view whose lifecycle is not React's, and
 * mounting it in the body rather than in the editor keeps it clear of the canvas transform — a menu
 * inside a shape would be scaled by the zoom and clipped by the shape's own bounds.
 */
class MenuView {
	private readonly dom: HTMLElement
	private items: Suggestion[] = []

	constructor(
		private readonly view: EditorView,
		private readonly onPick: (item: Suggestion) => void
	) {
		this.dom = document.createElement('div')
		this.dom.className = 'lb-suggest'
		this.dom.setAttribute('role', 'listbox')
		this.dom.style.display = 'none'
		// Pointer-down rather than click: the editor blurs on mousedown, and a blurred editor has no
		// selection to insert into.
		this.dom.addEventListener('pointerdown', (event) => {
			event.preventDefault()
			event.stopPropagation()
			const row = (event.target as HTMLElement).closest<HTMLElement>('[data-index]')
			if (!row) return
			const item = this.items[Number(row.dataset.index)]
			if (item) this.onPick(item)
		})
		document.body.appendChild(this.dom)
	}

	render(menu: MenuState | null): void {
		if (!menu) {
			this.dom.style.display = 'none'
			return
		}
		this.items = menu.items
		this.dom.replaceChildren(
			...menu.items.map((item, i) => {
				const row = document.createElement('div')
				row.className = i === menu.selected ? 'lb-suggest__row lb-suggest__row--on' : 'lb-suggest__row'
				row.dataset.index = String(i)
				row.setAttribute('role', 'option')
				row.setAttribute('aria-selected', String(i === menu.selected))
				const label = document.createElement('span')
				label.className = 'lb-suggest__label'
				label.textContent = item.label
				const detail = document.createElement('span')
				detail.className = 'lb-suggest__detail'
				detail.textContent = item.detail
				row.append(label, detail)
				return row
			})
		)
		const caret = this.view.coordsAtPos(menu.to)
		this.dom.style.display = 'block'
		this.dom.style.left = `${Math.round(caret.left)}px`
		this.dom.style.top = `${Math.round(caret.bottom + 4)}px`
	}

	destroy(): void {
		this.dom.remove()
	}
}

/**
 * @param properties Read lazily — the board's registry changes while a shape is open, and a property
 *   invented in a panel should be offered here without leaving edit mode.
 */
export function expressionSuggestExtension(properties: () => readonly PropertyDef[]) {
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
								const selected =
									(menu.selected + delta + menu.items.length) % menu.items.length
								view.dispatch(
									view.state.tr.setMeta(KEY, { type: 'select', selected } as MenuMeta)
								)
								return true
							}
							if (event.key === 'Enter' || event.key === 'Tab') {
								const item = menu.items[menu.selected]
								if (!item) return false
								accept(view, menu, item)
								return true
							}
							return false
						},
					},
					view: (view) => {
						const menuView = new MenuView(view, (item) => {
							/*
							 * Focus first, then insert.
							 *
							 * Clicking the menu blurs the editor however hard the pointer handler tries to
							 * prevent it, and a blurred ProseMirror reports no selection — so the menu state,
							 * which is derived entirely from where the caret is, went null and the menu shut
							 * itself mid-sequence. Reclaiming focus before dispatching means the transaction
							 * lands in an editor that still knows where it was.
							 */
							view.focus()
							const menu = KEY.getState(view.state)
							if (menu) accept(view, menu, item)
						})
						const visible = (state: EditorState) => {
							const menu = KEY.getState(state)
							return menu && !menu.dismissed ? menu : null
						}
						menuView.render(visible(view.state))
						return {
							update: (updated) => menuView.render(visible(updated.state)),
							destroy: () => menuView.destroy(),
						}
					},
				}),
			]
		},
	})
}
