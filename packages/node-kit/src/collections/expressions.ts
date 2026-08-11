import type { EdgeIndex } from '../edges'
import type { FactsMap } from '../facts'
import { formatCurrency, formatNumber, formatPropertyValue } from '../properties/format'
import type { RateTable } from '../properties/rates'
import { propertyIdFromName, type PropertyDef } from '../properties/types'
import type { ShapeProperties, ShapePropertyUnits } from '../properties/values'
import { runCollection } from './engine'
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
		text.replace(/\{([^{}\n]+)\}/g, (whole, body: string) => evaluate(body, context) ?? whole)
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

/** One expression's replacement, or `null` to leave it alone. */
function evaluate(body: string, context: ExpressionContext): string | null {
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
