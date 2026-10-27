import type { Editor } from '@lifeboard/canvas'
import { SuggestMenu, stepSelection, type Suggestion, type TextExtensionContext } from '@lifeboard/node-kit'
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { boxOrder, CARD_TYPE, isNumbered } from '../box'
import { LINK_PATTERN } from '../links'
import { nameOf } from './text'

/**
 * `[[` in a card's text: a menu of the box's notes and sources, by number or by what they say, that
 * writes the link as `[[25a]]` (links.ts). And a tint over every finished link while the card is being
 * written on, as the `{…}` expressions get one. Only on a box's cards: every other text editor on the
 * board is handed this too (node-kit's `textExtensions`), and leaves it alone.
 *
 * Built on ProseMirror directly, as node-kit's `{…}` helper is and for its reason: `@tiptap/suggestion`
 * would bring a second copy of ProseMirror. It reuses that helper's menu, so the two look alike.
 */

const KEY = new PluginKey<MenuState | null>('lifeboard:zettel-link-suggest')
const MAX_ITEMS = 8
/** `[[` and what has been typed after it, up to the caret, on one line. */
const OPEN_LINK = /\[\[\s*([^[\]\n]*)$/

interface MenuState {
	/** Where the `[[` starts, and the caret. */
	from: number
	to: number
	items: Suggestion[]
	selected: number
	dismissed: boolean
}

type MenuMeta = { type: 'dismiss' } | { type: 'select'; selected: number }

function writingOnACard(editor: Editor | null): editor is Editor {
	return editor?.getEditingShape()?.type === CARD_TYPE
}

/** What the box offers for `query`: the notes and sources whose number starts with it, then those that mention it. */
function linkSuggestions(editor: Editor, query: string): Suggestion[] {
	const self = editor.getEditingShapeId()
	const q = query.trim().toLowerCase()
	const byNumber: Suggestion[] = []
	const byWords: Suggestion[] = []
	for (const entry of boxOrder(editor)) {
		if (!entry.id || entry.id === self || (entry.kind !== 'note' && entry.kind !== 'source')) continue
		const shape = editor.getShape(entry.id)
		if (!isNumbered(shape)) continue
		const name =
			shape.type === CARD_TYPE
				? nameOf(shape.props.richText)
				: [shape.props.author, shape.props.title].filter(Boolean).join(', ')
		const item: Suggestion = { label: entry.zid, detail: name, kind: 'source', insert: `[[${entry.zid}]]`, terminal: true }
		if (!q || entry.zid.startsWith(q)) byNumber.push(item)
		else if (name.toLowerCase().includes(q)) byWords.push(item)
	}
	return [...byNumber, ...byWords].slice(0, MAX_ITEMS)
}

function stateFor(state: EditorState, editor: Editor | null): MenuState | null {
	if (!writingOnACard(editor)) return null
	const { empty, $from } = state.selection
	if (!empty || !$from.parent.isTextblock) return null
	const line = $from.parent.textBetween(0, $from.parentOffset, '\n', '\n')
	const open = OPEN_LINK.exec(line)
	if (!open) return null
	const items = linkSuggestions(editor, open[1] ?? '')
	if (!items.length) return null
	return { from: $from.pos - open[0].length, to: $from.pos, items, selected: 0, dismissed: false }
}

/** A tint over each finished `[[…]]`, so a link reads as one thing while it is being written. */
function linkDecorations(state: EditorState): DecorationSet {
	const found: Decoration[] = []
	state.doc.descendants((node, pos) => {
		if (!node.isTextblock) return true
		const text = node.textBetween(0, node.content.size, '\n', '\n')
		for (const match of text.matchAll(LINK_PATTERN)) {
			const start = pos + 1 + match.index
			found.push(Decoration.inline(start, start + match[0].length, { class: 'lb-zlink-token' }))
		}
		return false
	})
	return DecorationSet.create(state.doc, found)
}

function accept(view: EditorView, menu: MenuState, item: Suggestion): void {
	const { state } = view
	// `]]` typed already, by hand, is stepped over rather than doubled.
	const after = state.doc.textBetween(menu.to, Math.min(menu.to + 2, state.doc.content.size))
	const to = after === ']]' ? menu.to + 2 : menu.to
	const tr = state.tr.insertText(item.insert, menu.from, to)
	tr.setSelection(TextSelection.near(tr.doc.resolve(menu.from + item.insert.length)))
	view.dispatch(tr.scrollIntoView())
}

/** The extension's contribution to the board's text editors (`Extension.textExtensions`). */
export function linkTextExtensions({ editor }: TextExtensionContext) {
	return [
		Extension.create({
			name: 'lifeboardZettelLinks',
			addProseMirrorPlugins() {
				return [
					new Plugin<MenuState | null>({
						key: KEY,
						state: {
							init: (_config, state) => stateFor(state, editor()),
							apply: (tr, prev, _old, next) => {
								const menu = stateFor(next, editor())
								if (!menu) return null
								const meta = tr.getMeta(KEY) as MenuMeta | undefined
								if (meta?.type === 'dismiss') return { ...menu, dismissed: true }
								const same = prev !== null && prev.from === menu.from
								const selected =
									meta?.type === 'select'
										? meta.selected
										: same
											? Math.min(prev.selected, menu.items.length - 1)
											: 0
								return { ...menu, selected, dismissed: same ? prev.dismissed : false }
							},
						},
						props: {
							decorations: (state) => (writingOnACard(editor()) ? linkDecorations(state) : null),
							handleKeyDown: (view, event) => {
								const menu = KEY.getState(view.state)
								if (!menu || menu.dismissed) return false
								if (event.key === 'Escape') {
									view.dispatch(view.state.tr.setMeta(KEY, { type: 'dismiss' } as MenuMeta))
									return true
								}
								if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
									const selected = stepSelection(menu.selected, event.key === 'ArrowDown' ? 1 : -1, menu.items.length)
									view.dispatch(view.state.tr.setMeta(KEY, { type: 'select', selected } as MenuMeta))
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
							// Answered from what was drawn: a click blurs the editor before it lands (see node-kit's).
							let drawn: MenuState | null = null
							// Made the first time there is something to show: every text editor on the board
							// carries this plugin, and only a box's cards ever open the menu.
							let menuView: SuggestMenu | null = null
							const paint = (state: EditorState) => {
								const menu = KEY.getState(state)
								drawn = menu && !menu.dismissed ? menu : null
								const rect = drawn ? view.coordsAtPos(drawn.to) : null
								if (!drawn && !menuView) return
								menuView ??= new SuggestMenu((item) => {
									view.focus()
									if (drawn) accept(view, drawn, item)
								})
								menuView.render(drawn && rect ? { items: drawn.items, selected: drawn.selected, caret: rect } : null)
							}
							paint(view.state)
							return { update: (updated) => paint(updated.state), destroy: () => menuView?.destroy() }
						},
					}),
				]
			},
		}),
	]
}
