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
import { EXPRESSION_OPS } from './expressions'

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

/** Where the caret sits inside an unclosed `{`, or `null` when it is not in one at all. */
function expressionAt(context: CompletionContext): { open: number; body: string } | null {
	const line = context.state.doc.lineAt(context.pos)
	const before = line.text.slice(0, context.pos - line.from)
	const open = before.lastIndexOf('{')
	if (open === -1) return null
	// A closed expression before the caret is finished business, not something to complete.
	if (before.slice(open).includes('}')) return null
	return { open: line.from + open, body: before.slice(open + 1) }
}

/*
 * What the menu offers, listed rather than derived from the parser's vocabulary.
 *
 * The parser accepts aliases — `total` for `sum`, `average` for `avg`, `board` for `page` — because
 * someone typing from memory should not have to remember which spelling won. Offering both would put
 * the same verb in the menu twice and make a short list look like a long one, so the menu names one
 * of each and the alias stays a thing that works when typed.
 *
 * Declaration order is the menu order, held there by a descending boost. Left to itself CodeMirror
 * sorts equal scores alphabetically, which puts `avg` above `sum` and `either` above `in` — the rare
 * answer above the common one in both cases.
 */
const OFFERED_OPS: [string, string][] = [
	['sum', 'add them up'],
	['count', 'how many'],
	['avg', 'the average'],
	['min', 'the smallest'],
	['max', 'the largest'],
	['median', 'the middle one'],
]

const OFFERED_SOURCES: [string, string][] = [
	['in', 'arrows pointing at this'],
	['out', 'arrows pointing away'],
	['either', 'both ways — in adds, out subtracts'],
	['frame', 'shapes in this frame'],
	['page', 'everything on this board'],
]

/** Keeps a list in the order it was written. Higher sorts first; the offset lifts a whole group. */
function ranked(index: number, length: number, offset = 0): number {
	return offset + (length - index)
}

/**
 * Re-opens the menu after inserting, so one choice leads to the next.
 *
 * This is what turns the helper into something you can drive with a mouse: pick a verb, the
 * properties appear; pick a property, the places appear. Without it every step would need the `{`
 * dance again.
 */
function chain(insert: string): Completion['apply'] {
	return (view, _completion, from, to) => {
		view.dispatch({
			changes: { from, to, insert },
			selection: { anchor: from + insert.length },
			userEvent: 'input.complete',
		})
		queueMicrotask(() => startCompletion(view))
	}
}

/** The last step closes the expression and steps over the brace, because there is nothing left to say. */
function finish(insert: string): Completion['apply'] {
	return (view, _completion, from, to) => {
		// The closing brace is already there — `{` wrote it — so this steps past rather than adding one.
		const after = view.state.doc.sliceString(to, to + 1)
		const closing = after === '}' ? 1 : 0
		view.dispatch({
			changes: { from, to, insert: closing ? insert : `${insert}}` },
			selection: { anchor: from + insert.length + 1 },
			userEvent: 'input.complete',
		})
	}
}

function expressionSource(properties: () => readonly PropertyDef[]) {
	return (context: CompletionContext): CompletionResult | null => {
		const found = expressionAt(context)
		if (!found) return null

		const words = found.body.split(/\s+/)
		const typing = words[words.length - 1] ?? ''
		const settled = words.slice(0, -1).filter(Boolean)
		const from = context.pos - typing.length
		const defs = properties()

		const propertyOptions = (apply: (label: string) => Completion['apply']): Completion[] =>
			defs.map((def) => ({
				label: def.name,
				type: 'property',
				detail: def.type,
				apply: apply(def.name),
			}))

		// Nothing settled yet: either a verb, or a bare property for this shape's own value.
		if (settled.length === 0) {
			return {
				from,
				options: [
					...OFFERED_OPS.map(
						([op, detail], i): Completion => ({
							label: op,
							type: 'keyword',
							detail,
							// Above the bare properties: asking a question about the board is the common
							// case, and reading this shape's own value back to itself is the rare one.
							boost: ranked(i, OFFERED_OPS.length, 10),
							apply: chain(`${op} `),
						})
					),
					...propertyOptions((label) => finish(label)),
				],
				validFor: /^[\w ]*$/,
			}
		}

		// A verb is settled. The second word is the property; anything after it is the place to look.
		const isOp = settled[0]!.toLowerCase() in EXPRESSION_OPS
		if (!isOp) return null

		const sourceOptions = OFFERED_SOURCES.map(
			([key, detail], i): Completion => ({
				label: key,
				type: 'keyword',
				detail,
				boost: ranked(i, OFFERED_SOURCES.length),
				apply: finish(key),
			})
		)

		return {
			from,
			options:
				settled.length === 1
					? // Property first: a verb is nearly always followed by what it acts on, and the
						// places to look are still there for `{count in}`, which needs no property.
						[
							...propertyOptions((label) => chain(`${label} `)).map((option) => ({
								...option,
								boost: 10,
							})),
							...sourceOptions,
						]
					: sourceOptions,
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
