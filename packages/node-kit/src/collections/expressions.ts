import type { EdgeIndex } from '../edges'
import type { FactsMap } from '../facts'
import { formatCurrency, formatNumber, formatPropertyValue } from '../properties/format'
import type { RateTable } from '../properties/rates'
import { propertyIdFromName, type PropertyDef } from '../properties/types'
import type { ShapeProperties, ShapePropertyUnits } from '../properties/values'
import { runCollection } from './engine'
import { getQuery } from './namedQueries'
import { defaultCollection, type Collection } from './spec'

/**
 * `{…}` in a note, evaluated against the board.
 *
 * The point is that a number belongs in the sentence that explains it. Before this, wanting a total
 * beside the words "still free" meant parking a whole table next to the note and reading across —
 * which is most of the reason a table felt like a separate kind of object rather than a way of
 * looking at a set. Obsidian's Dataview does the same thing inline, and for the same reason.
 *
 * Two forms, and the first token decides which:
 *
 *   {price}                 — this shape's own value, formatted by its type
 *   {sum price}             — the total of Price over the arrows pointing in
 *   {sum price either}      — the same, as a balance: in adds, out subtracts
 *   {count}                 — how many shapes point at this one
 *   {avg rating page}       — across the whole board
 *
 * Anything it does not recognise is **left exactly as typed**. That is deliberate rather than lazy:
 * braces are ordinary punctuation in prose and everywhere in code, so a feature that swallowed them
 * would damage notes written before it existed. An unresolved `{…}` looks like what you typed.
 */

/** Ops reachable from an expression. A deliberately short list — the panel has the long one. */
export const EXPRESSION_OPS: Record<string, Collection['op']> = {
	sum: 'sum',
	total: 'sum',
	count: 'count',
	avg: 'avg',
	average: 'avg',
	median: 'median',
	min: 'min',
	max: 'max',
}

/** The trailing keyword that says where to look. Absent means the arrows pointing in. */
export const EXPRESSION_SOURCES: Record<string, { scope: 'page' | 'frame' | 'connected'; direction?: string }> = {
	in: { scope: 'connected', direction: 'in' },
	out: { scope: 'connected', direction: 'out' },
	either: { scope: 'connected', direction: 'either' },
	frame: { scope: 'frame' },
	page: { scope: 'page' },
	board: { scope: 'page' },
}

export interface ExpressionContext {
	facts: FactsMap
	edges: EdgeIndex
	properties: ReadonlyMap<string, PropertyDef>
	rates: RateTable | null
	selfId: string
	/** The note's own values, for the `{price}` form. */
	values: ShapeProperties
	units: ShapePropertyUnits
}

/**
 * Substitutes every expression in a note's source.
 *
 * Runs on the markdown *before* it is parsed, and never changes the line structure — a value is one
 * line's worth of text, always — so the task indices `MarkdownView` derives stay aligned with the
 * source that `toggleTaskAt` edits.
 */
export function renderExpressions(md: string, context: ExpressionContext): string {
	if (!md.includes('{')) return md
	return mapOutsideCode(md, (text) =>
		text.replace(/\{([^{}\n]+)\}/g, (whole, body: string) => evaluateExpression(body, context) ?? whole)
	)
}

/**
 * Applies `fn` to the parts of a markdown document that are prose, leaving code alone.
 *
 * A note is somewhere people paste code, and `{sum price}` inside a fence has to survive as itself.
 * Fenced blocks are tracked line by line; inline spans are split on backtick runs, and a run only
 * closes on a run of the same length, which is how markdown's own rule works.
 */
function mapOutsideCode(md: string, fn: (text: string) => string): string {
	const lines = md.split('\n')
	let fence: string | null = null
	return lines
		.map((line) => {
			const opener = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
			if (fence) {
				// Closing needs at least as many markers as opened it, and nothing else on the line.
				if (opener && opener[1]![0] === fence[0] && opener[1]!.length >= fence.length) fence = null
				return line
			}
			if (opener) {
				fence = opener[1]!
				return line
			}
			return mapOutsideInlineCode(line, fn)
		})
		.join('\n')
}

function mapOutsideInlineCode(line: string, fn: (text: string) => string): string {
	if (!line.includes('`')) return fn(line)
	// Split keeping the delimiters, then walk: even segments are prose, odd ones are code spans.
	const parts = line.split(/(`+)/)
	let out = ''
	let open: string | null = null
	for (const part of parts) {
		if (/^`+$/.test(part)) {
			if (open === null) open = part
			else if (part.length === open.length) open = null
			out += part
			continue
		}
		out += open === null ? fn(part) : part
	}
	return out
}

/**
 * One expression's value, or `null` when it does not resolve to one — which is the signal to leave
 * what was typed exactly as it is (`renderExpressions` does precisely that).
 *
 * Exported because the note is no longer the only thing asking. The ⌘K palette's `=` mode evaluates
 * a single expression on its own rather than substituting one inside a document, and it must get the
 * same answer to the same question: one evaluator, or the palette and the board start disagreeing
 * about what `sum price` means.
 */
export function evaluateExpression(body: string, context: ExpressionContext): string | null {
	return evaluateBody(expandNamedQuery(body, context.properties), context)
}

/**
 * How deep a name may stand for another name. Four is generous for aliasing and finite, which is the
 * only property that matters: `a` = `b` and `b` = `a` is a typo someone will make, and it must cost
 * them a `—` rather than the tab.
 */
const MAX_QUERY_DEPTH = 4

/**
 * Swaps a named query for the expression it stands for, following aliases.
 *
 * **A property always wins.** The check against the board's own registry is what makes this feature
 * unable to change the meaning of anything already written: a query can only ever resolve a body
 * that resolved to nothing before it existed. Verbs are handled earlier, at registration — a query
 * cannot be *called* `sum` — but property names are per-board and unknowable then, so a board that
 * happens to have a "runway" property keeps it, and the query quietly does not apply there. Losing a
 * shorthand is recoverable; a note that silently starts reporting a different number is not.
 *
 * Only the *whole* body expands. `{sum runway}` is not "sum of the runway query" — a query is a
 * question, not a column — and a rule that expanded fragments would make every expression's meaning
 * depend on a registry the person reading it cannot see.
 */
function expandNamedQuery(
	body: string,
	properties: ExpressionContext['properties'],
	depth = 0
): string {
	if (depth >= MAX_QUERY_DEPTH) return body
	const trimmed = body.trim()
	if (!trimmed || findProperty(trimmed, properties)) return body
	const query = getQuery(trimmed)
	if (!query) return body
	return expandNamedQuery(query.body, properties, depth + 1)
}

/** One expression's value, once any name it used has been swapped for what it stands for. */
function evaluateBody(body: string, context: ExpressionContext): string | null {
	const tokens = body.trim().split(/\s+/).filter(Boolean)
	if (!tokens.length) return null

	const op = EXPRESSION_OPS[tokens[0]!.toLowerCase()]
	if (!op) {
		// No op, so this is the shape's own value — the `{price}` form.
		const def = findProperty(tokens.join(' '), context.properties)
		if (!def) return null
		return formatPropertyValue(def, context.values[def.id] ?? null, context.units[def.id])
	}

	const rest = tokens.slice(1)
	// The *last* token decides the source, so a property called "page" loses to the keyword. Rare
	// enough to accept, and the alternative — guessing from the middle — is worse to explain.
	const tail = rest.length ? EXPRESSION_SOURCES[rest[rest.length - 1]!.toLowerCase()] : undefined
	const nameTokens = tail ? rest.slice(0, -1) : rest
	const def = nameTokens.length ? findProperty(nameTokens.join(' '), context.properties) : undefined
	// A named property that matches nothing is a typo, not a count. Leaving it visible says so.
	if (nameTokens.length && !def) return null

	const base = defaultCollection()
	const collection: Collection = {
		...base,
		view: 'value',
		op,
		property: def?.id ?? null,
		source: {
			...base.source,
			scope: tail?.scope ?? 'connected',
			direction: (tail?.direction ?? (tail ? undefined : 'in')) as Collection['source']['direction'],
			signed: tail?.direction === 'either',
		},
	}

	const result = runCollection(
		context.facts,
		collection,
		context.selfId,
		context.properties,
		context.rates,
		context.edges
	)
	if (result.value === null) return '—'
	return result.unit ? formatCurrency(result.value, result.unit) : formatNumber(result.value)
}

/** By id, by name, or by the slug of the name — so `{sum Unit Price}` finds `unit_price`. */
function findProperty(
	reference: string,
	properties: ReadonlyMap<string, PropertyDef>
): PropertyDef | undefined {
	const direct = properties.get(reference)
	if (direct) return direct
	const wanted = reference.trim().toLowerCase()
	const slug = propertyIdFromName(reference)
	for (const def of properties.values()) {
		if (def.id === slug) return def
		if (def.name.trim().toLowerCase() === wanted) return def
	}
	return undefined
}

/**
 * The same expression, said in full — with the place to look spelled out when it was left implicit.
 *
 * `EXPRESSION_SOURCES` defaults to the arrows pointing in, which is right *inside a note*: the note
 * is the subject, and "the things pointing at me" is what it is asking about. A question typed into
 * ⌘K has no subject. Defaulting to `connected` there would answer `—` to nearly everything, because
 * the thing being asked from is a text field.
 *
 * So the palette rewrites the question before asking it, rather than the evaluator growing a mode.
 * That is the load-bearing choice: the rewritten body is *also* what gets written into a shape when
 * you drop the answer on the board, so what you previewed and what the board then computes for
 * itself are the same string. A default held in the evaluator could not have travelled with it, and
 * `{sum price}` dropped as a text shape would have quietly started meaning "arrows pointing at this
 * caption" — which is nothing.
 *
 * The bare-property form (`{price}`) is left alone: it reads the *selected* shape's own value, and
 * there is nowhere else for it to look.
 */
export function expressionForBoard(body: string): string {
	// The *literal* text, deliberately not `isAggregateExpression` — which sees through a named
	// question, and must not here. `{runway}` carries its own scope inside the expression it stands
	// for, and the name is what gets written to the board, so appending `page` to the name would
	// produce `runway page`, which stands for nothing at all.
	if (!startsWithOp(body)) return body
	const tokens = body.trim().split(/\s+/)
	const last = tokens[tokens.length - 1]!.toLowerCase()
	// `{sum price page}` already says where; `{count}` does not, and means the whole board here.
	if (tokens.length > 1 && last in EXPRESSION_SOURCES) return body
	return `${tokens.join(' ')} page`
}

/**
 * Whether this asks about a *set* — `{sum price}`, `{count}` — rather than about one shape's own
 * value, which is what the bare-property form `{price}` does.
 *
 * The distinction decides who the expression's *subject* is, and getting it wrong is quiet rather
 * than loud. A query excludes its own shape from the rows it collects (`query.ts`: "a table never
 * includes itself"), so evaluating `{count page}` on behalf of some shape answers "everything except
 * that one". In a note that is right — the note is asking about the rest of the board. Asked from
 * the palette, where the subject is a text field, it silently subtracts whatever happened to be
 * selected at the time.
 */
export function isAggregateExpression(
	body: string,
	/**
	 * The board's properties, so a name that collides with one is judged as the property it will
	 * actually resolve to. Omitted, a colliding name is read as the query — a wrong answer only in
	 * that collision, and only ever "this has no subject", which is the safer way to be wrong.
	 */
	properties: ExpressionContext['properties'] = new Map()
): boolean {
	// Through the name, unlike `expressionForBoard` above: what matters here is what the question
	// will *resolve* to, because that is what decides whether a query gets to exclude a subject.
	return startsWithOp(expandNamedQuery(body, properties))
}

/** Whether the first word is one of the verbs, as written. The shared half of the two rules above. */
function startsWithOp(body: string): boolean {
	const first = body.trim().split(/\s+/)[0]
	return first !== undefined && first !== '' && first.toLowerCase() in EXPRESSION_OPS
}
