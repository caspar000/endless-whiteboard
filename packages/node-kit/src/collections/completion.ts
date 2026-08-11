import {
	autocompletion,
	startCompletion,
	type Completion,
	type CompletionContext,
	type CompletionResult,
} from '@codemirror/autocomplete'
import {
	Decoration,
	EditorView,
	ViewPlugin,
	type DecorationSet,
	type ViewUpdate,
} from '@codemirror/view'
import { RangeSetBuilder, type Extension } from '@codemirror/state'
import type { PropertyDef } from '../properties/types'
import { expressionBodyAt, expressionSuggestions, type Suggestion } from './suggest'

/**
 * The helper for writing `{…}`.
 *
 * Formula editors converged on the same three things and this does all of them: a menu that opens on
 * the character that starts an expression, suggestions that narrow as the expression takes shape, and
 * a tint on the finished token so it reads as one object rather than as punctuation you typed. Notion
 * calls the last one a property token and shades it grey; Sheets and Airtable do the argument hints.
 *
 * The menu is **positional**, which is what makes it teachable: what it offers depends on how far
 * into the expression you are, so `{` shows the verbs, a verb shows the properties, and a property
 * shows the places to look. Every step is clickable, so an expression can be built with the mouse
 * from the `{` onwards — and typed straight through by anyone who has learnt it, which is faster.
 */

/** Opening a brace writes the closing one, so the menu has a complete expression to sit inside. */
function closeBrace(): Extension {
	return EditorView.inputHandler.of((view, from, to, text) => {
		if (text !== '{') return false
		view.dispatch({
			changes: { from, to, insert: '{}' },
			selection: { anchor: from + 1 },
			userEvent: 'input.type',
		})
		// Straight into the menu: the whole point is that `{` is the only key you must know.
		queueMicrotask(() => startCompletion(view))
		return true
	})
}

/**
 * Re-opens the menu after a non-terminal choice, so one step leads to the next.
 *
 * This is what turns the helper into something you can drive with a mouse: pick a verb, the
 * properties appear; pick a property, the places appear.
 */
function applyOf(suggestion: Suggestion): Completion['apply'] {
	return (view, _completion, from, to) => {
		if (!suggestion.terminal) {
			view.dispatch({
				changes: { from, to, insert: suggestion.insert },
				selection: { anchor: from + suggestion.insert.length },
				userEvent: 'input.complete',
			})
			queueMicrotask(() => startCompletion(view))
			return
		}
		// The closing brace is already there — typing `{` wrote it — so this steps past rather than
		// adding a second one.
		const closed = view.state.doc.sliceString(to, to + 1) === '}'
		view.dispatch({
			changes: { from, to, insert: closed ? suggestion.insert : `${suggestion.insert}}` },
			selection: { anchor: from + suggestion.insert.length + 1 },
			userEvent: 'input.complete',
		})
	}
}

function expressionSource(properties: () => readonly PropertyDef[]) {
	return (context: CompletionContext): CompletionResult | null => {
		const line = context.state.doc.lineAt(context.pos)
		const found = expressionBodyAt(line.text, context.pos - line.from)
		if (!found) return null
		const result = expressionSuggestions(found.body, properties())
		if (!result) return null

		return {
			from: line.from + found.start + result.from,
			// CodeMirror sorts equal scores alphabetically, which would undo the ordering the shared
			// core went to the trouble of choosing. A descending boost pins the order it returned.
			options: result.items.map(
				(item, i): Completion => ({
					label: item.label,
					detail: item.detail,
					type: item.kind === 'property' ? 'property' : 'keyword',
					boost: result.items.length - i,
					apply: applyOf(item),
				})
			),
			validFor: /^[\w ]*$/,
		}
	}
}

/** A tint over every complete `{…}`, so a finished expression reads as one object. */
const EXPRESSION_MARK = Decoration.mark({ class: 'lb-cm-expr' })

const highlightExpressions = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet
		constructor(view: EditorView) {
			this.decorations = build(view)
		}
		update(update: ViewUpdate) {
			if (update.docChanged || update.viewportChanged) this.decorations = build(update.view)
		}
	},
	{ decorations: (value) => value.decorations }
)

function build(view: EditorView): DecorationSet {
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
	return [
		closeBrace(),
		autocompletion({
			override: [expressionSource(properties)],
			// Ours is the only source, and it already refuses to fire outside `{…}`.
			activateOnTyping: true,
			closeOnBlur: false,
			icons: false,
		}),
		highlightExpressions,
	]
}
