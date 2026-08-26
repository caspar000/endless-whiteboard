import type { PropertyDef } from '../properties/types'
import { EXPRESSION_OPS } from './expressions'
import { getVisibleQueries } from './namedQueries'

/**
 * What to offer while someone is writing `{…}` — the logic, with no editor in it.
 *
 * Two editors ask this question now: CodeMirror in the note, and ProseMirror in every shape tldraw
 * draws itself. The rules are the interesting part and they must not drift, so they live here and the
 * adapters do nothing but translate positions and dispatch inserts.
 *
 * The menu is **positional**, which is what makes it teachable: `{` shows the verbs, a verb shows the
 * properties, a property shows the places to look. Ordering is by usefulness rather than alphabet —
 * `sum` above `avg`, `in` above `either` — because the rare answer sitting above the common one is
 * the difference between a menu that teaches and one you have to read every time.
 */

export type SuggestionKind = 'op' | 'property' | 'source' | 'query'

export interface Suggestion {
	label: string
	detail: string
	kind: SuggestionKind
	/** Text to write in place of the word being typed. */
	insert: string
	/**
	 * Whether the expression is complete after this.
	 *
	 * Terminal steps close the brace and stop; the rest leave a trailing space and re-open the menu,
	 * which is what lets a whole expression be built with the mouse from the `{` onwards.
	 */
	terminal: boolean
}

export interface SuggestionResult {
	/** Offset **within the brace body** where the word being typed starts. */
	from: number
	items: Suggestion[]
}

/*
 * What the menu offers, listed rather than derived from the parser's vocabulary.
 *
 * The parser accepts aliases — `total` for `sum`, `average` for `avg`, `board` for `page` — because
 * someone typing from memory should not have to remember which spelling won. Offering both would put
 * one verb in the menu twice and make a short list look like a long one, so the menu names one of
 * each and the alias stays a thing that works when typed.
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

/**
 * The text of an unclosed `{` before `caret`, or `null`.
 *
 * Only ever looks at one line: an expression that ran past a newline would be a runaway brace
 * swallowing a paragraph, and refusing to complete it is how someone finds that out early.
 */
export function expressionBodyAt(
	line: string,
	caret: number
): { start: number; body: string } | null {
	const before = line.slice(0, caret)
	const open = before.lastIndexOf('{')
	if (open === -1) return null
	// A closed expression before the caret is finished business, not something to complete.
	if (before.slice(open).includes('}')) return null
	return { start: open + 1, body: before.slice(open + 1) }
}

/** What to offer given the text between `{` and the caret. `null` when there is nothing to say. */
export function expressionSuggestions(
	body: string,
	properties: readonly PropertyDef[]
): SuggestionResult | null {
	const words = body.split(/\s+/)
	const typing = words[words.length - 1] ?? ''
	const settled = words.slice(0, -1).filter(Boolean)
	const from = body.length - typing.length

	const asProperties = (terminal: boolean): Suggestion[] =>
		properties.map((def) => ({
			label: def.name,
			detail: def.type,
			kind: 'property' as const,
			insert: terminal ? def.name : `${def.name} `,
			terminal,
		}))

	const asSources = (): Suggestion[] =>
		OFFERED_SOURCES.map(([label, detail]) => ({
			label,
			detail,
			kind: 'source' as const,
			insert: label,
			terminal: true,
		}))

	// Nothing settled: a verb, a saved question, or a bare property for this shape's own value.
	if (settled.length === 0) {
		return {
			from,
			items: filter(
				[
					...OFFERED_OPS.map(([label, detail]) => ({
						label,
						detail,
						kind: 'op' as const,
						insert: `${label} `,
						terminal: false,
					})),
					/*
					 * A question someone already composed, offered wherever the vocabulary is.
					 *
					 * This is what makes the namespace *shared* rather than merely reachable from two
					 * places: save "runway" from ⌘K and it is in the menu of every note on every board,
					 * because both menus are this function. Above properties because a saved question is
					 * something a person deliberately named, and below the verbs because those are the
					 * grammar — you can always fall back to spelling the question out.
					 */
					...getVisibleQueries().map((query) => ({
						label: query.name,
						detail: query.description ?? query.body,
						kind: 'query' as const,
						insert: query.name,
						terminal: true,
					})),
					// Below both: reading this shape's own value back to itself is the rare one.
					...asProperties(true),
				],
				typing
			),
		}
	}

	// Past the first word, only a verb has anywhere left to go. `{price ` is already complete.
	if (!(settled[0]!.toLowerCase() in EXPRESSION_OPS)) return null

	return {
		from,
		items: filter(
			settled.length === 1
				? // Property first: a verb is nearly always followed by what it acts on, and the places
					// to look are still there for `{count in}`, which needs no property.
					[...asProperties(false), ...asSources()]
				: asSources(),
			typing
		),
	}
}

/**
 * Narrows on what has been typed, case-insensitively, matching anywhere in the label.
 *
 * Substring rather than prefix because property names are phrases — someone reaching for "Unit price"
 * types `price` as often as `unit`, and a prefix match would offer them nothing for it.
 */
function filter(items: Suggestion[], typing: string): Suggestion[] {
	const needle = typing.trim().toLowerCase()
	if (!needle) return items
	return items.filter((item) => item.label.toLowerCase().includes(needle))
}
