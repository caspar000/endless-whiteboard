import type { FactsMap } from '../facts'
import type { EdgeIndex } from '../edges'
import { EMPTY_EDGE_INDEX } from '../edges'
import { queryTable } from '../nodes/table/query'
import {
	DEFAULT_COLUMN_WIDTH,
	DEFAULT_MAX_ROWS,
	LABEL_COLUMN,
	type TableNodeProps,
	type TableSource,
} from '../nodes/table/spec'
import { formatPropertyValue } from '../properties/format'
import type { PropertyDef } from '../properties/types'
import type { RateTable } from '../properties/rates'
import type { Collection } from './spec'

/**
 * One line of a collection's `list` view.
 *
 * `text` rather than a raw value because the shape drawing this has no registry in hand and no
 * business formatting money — the same reason `TableRow` carries units.
 */
export interface CollectionRow {
	shapeId: string
	label: string
	text: string
}

export interface CollectionResult {
	/** The summary, or `null` when there is nothing usable to summarise. */
	value: number | null
	/** How the value should be read: money needs a symbol, a count must not get one. */
	unit: string | undefined
	/** Rows that matched, for the `list` view. Capped — see `DEFAULT_MAX_ROWS`. */
	rows: CollectionRow[]
	matched: number
}

export const EMPTY_COLLECTION_RESULT: CollectionResult = {
	value: null,
	unit: undefined,
	rows: [],
	matched: 0,
}

/**
 * Runs a collection by asking the table engine.
 *
 * Deliberately a thin adapter rather than a second implementation. Every hard part — scopes, arrow
 * direction, filters, currency conversion, the money provenance that stops a mixed-currency total
 * from lying — already lives in `queryTable` and is covered by its tests. A collection is a table
 * with one column and no chrome, so it asks the same question and reads one answer out.
 */
/**
 * "Shapes in this frame" means **the frame the collecting shape is in**.
 *
 * A table is a shape you point at a frame, so it stores which one; a collection is carried *by* the
 * shape asking the question, and the menu it is chosen from says "this frame" — so the frame is not a
 * second thing to pick, it is wherever the shape currently sits. Resolved here on every run rather
 * than stamped in once, so dragging a collecting sticky from one frame into another re-aims it, which
 * is what the wording promises.
 *
 * A frame id that *is* set wins: an agent (or a future picker) can still aim a collection at some
 * other frame, and a shape sitting on open canvas resolves to nothing and matches nothing — correct,
 * since there is no frame it is in.
 */
function frameSource(source: TableSource, facts: FactsMap, selfId: string): TableSource {
	if (source.scope !== 'frame' || source.frameId !== null) return source
	return { ...source, frameId: facts.get(selfId)?.parentId ?? null }
}

export function runCollection(
	facts: FactsMap,
	collection: Collection,
	selfId: string,
	properties: ReadonlyMap<string, PropertyDef> = new Map(),
	rates: RateTable | null = null,
	edges: EdgeIndex = EMPTY_EDGE_INDEX
): CollectionResult {
	const key = collection.property ?? LABEL_COLUMN
	const props: TableNodeProps = {
		title: '',
		source: frameSource(collection.source, facts, selfId),
		// The label column earns its place even when a property is chosen: without it a shape carrying
		// none of the collection's properties is not a row at all, and "count what points at me" has to
		// count the blank ones too.
		columns:
			key === LABEL_COLUMN
				? [{ key: LABEL_COLUMN, summary: collection.op, width: DEFAULT_COLUMN_WIDTH }]
				: [
						{ key: LABEL_COLUMN, summary: null, width: DEFAULT_COLUMN_WIDTH },
						{ key, summary: collection.op, width: DEFAULT_COLUMN_WIDTH },
					],
		groupBy: null,
		sorts: [],
		layout: { mode: 'table', maxRows: DEFAULT_MAX_ROWS },
		rates: {},
	}

	const result = queryTable(facts, props, selfId, properties, rates, edges)
	const def = collection.property ? properties.get(collection.property) : undefined
	const rows: CollectionRow[] = []
	for (const group of result.groups) {
		for (const row of group.rows) {
			rows.push({
				shapeId: row.shapeId,
				label: row.label,
				text: def ? formatPropertyValue(def, row.cells[key] ?? null, row.units[key]) : '',
			})
		}
	}

	return {
		value: result.summaries[key] ?? null,
		// A count is a plain number however the property is denominated: stamping ₾ on "3 things" is
		// the kind of confident nonsense that makes someone stop trusting every other figure too.
		unit: collection.op === 'count' ? undefined : result.money[key]?.unit,
		rows,
		matched: result.matched,
	}
}
