import { runCollection } from '../collections/engine'
import type { Collection } from '../collections/spec'
import { getPageEdges, readPageFacts } from '../nodes/rollup/engine'
import { FILTER_OPS, SUMMARY_OPS, type FilterOp, type SummaryOp, type TableFilter } from '../nodes/table/spec'
import { defineOperation, fail, ok, type RegisteredOperation } from '../operations'
import { getCurrentRates } from '../properties/rates'
import { propertyMap } from '../properties/schema'
import { BOARD_ID_PARAM, MAX_RESULTS, propertyDefs, resolveEditor, resolveProperty } from './shared'

/**
 * Asking a board a question, without building a table on it to see the answer.
 *
 * A thin adapter over `runCollection`, which is itself a thin adapter over `queryTable` — so scopes,
 * filters, currency conversion and the money provenance that stops a mixed-currency total from lying
 * are the same code the table nodes use, already covered by their tests. An agent asking "what do
 * these come to?" gets the number the board would show, not a second implementation's opinion.
 *
 * Deliberately narrower than `TableSource`: page scope, one optional filter. The full selector is a
 * nested object, and flattening it into named scalars is what keeps the schema something an agent can
 * fill in correctly first time. A richer query operation can be added later without touching this one.
 */
export const queryOperations: RegisteredOperation[] = [
	defineOperation({
		id: 'board.query',
		title: 'Query a board',
		description:
			'Summarises the shapes on a board — "what do the prices come to?", "how many are done?". Returns the value and the rows that went into it. For simply listing shapes, node.find is more direct.',
		readOnly: true,
		params: {
			property: {
				type: 'string',
				description:
					'The property to summarise, by name or id. Omit to count rows rather than summarise a value.',
			},
			op: {
				type: 'string',
				description:
					'What to work out: sum, avg, min, max, median, or one of the count/percent variants. Defaults to count.',
				choices: SUMMARY_OPS,
			},
			shapeType: {
				type: 'string',
				description: 'Only count shapes of this type. Omit for every shape on the board.',
			},
			filterProperty: {
				type: 'string',
				description: 'Restrict to shapes whose value for this property matches the filter.',
			},
			filterOp: {
				type: 'string',
				description: 'How to compare — defaults to isNotEmpty, which needs no filterValue.',
				choices: FILTER_OPS,
			},
			filterValue: {
				type: 'string',
				description:
					'The value to compare against. Read as a number when it looks like one, so "100" works for gt and lt.',
			},
			boardId: BOARD_ID_PARAM,
		},
		run: async (ctx, args) => {
			const resolved = await resolveEditor(ctx, args.boardId)
			if (!resolved.ok) return fail(resolved.error)
			const editor = resolved.editor
			const defs = propertyDefs(editor)

			const named = (raw: string | undefined, label: string) => {
				if (!raw) return { ok: true as const, def: undefined }
				const def = resolveProperty(defs, raw)
				if (def) return { ok: true as const, def }
				const known = defs.map((candidate) => candidate.name).join(', ')
				return {
					ok: false as const,
					error: `No property called "${raw}" for ${label}.${known ? ` Known: ${known}.` : ''}`,
				}
			}

			const summarised = named(args.property, 'property')
			if (!summarised.ok) return fail(summarised.error)
			const filtered = named(args.filterProperty, 'filterProperty')
			if (!filtered.ok) return fail(filtered.error)

			const filters: TableFilter[] = []
			if (filtered.def) {
				// A numeric-looking threshold has to *be* a number, or `gt` compares strings and "9" > "100".
				const raw = args.filterValue
				const asNumber = raw !== undefined && raw.trim() !== '' ? Number(raw) : Number.NaN
				filters.push({
					propertyId: filtered.def.id,
					op: (args.filterOp ?? 'isNotEmpty') as FilterOp,
					value: raw === undefined ? null : Number.isFinite(asNumber) ? asNumber : raw,
				})
			} else if (args.filterOp || args.filterValue) {
				return fail('filterOp and filterValue need a filterProperty to apply to.')
			}

			const collection: Collection = {
				source: {
					shapeTypes: args.shapeType ? [args.shapeType] : null,
					scope: 'page',
					frameId: null,
					filters,
				},
				view: 'list',
				op: (args.op ?? 'count') as SummaryOp,
				property: summarised.def?.id ?? null,
			}

			const result = runCollection(
				// The uncached walk: this is a question asked once, not a view that has to stay quiet
				// during a drag.
				readPageFacts(editor),
				collection,
				// `selfId` only matters for `scope: 'connected'`, which this operation does not offer.
				'',
				propertyMap(defs),
				getCurrentRates(),
				getPageEdges(editor).get()
			)

			return ok({
				value: result.value,
				unit: result.unit ?? null,
				matched: result.matched,
				truncated: result.rows.length > MAX_RESULTS,
				rows: result.rows.slice(0, MAX_RESULTS).map((row) => ({
					shapeId: row.shapeId,
					label: row.label,
					text: row.text,
				})),
			})
		},
	}),
]
