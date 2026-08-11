import { createMigrationIds, createMigrationSequence } from '@tldraw/store'
import type { MigrationSequence } from '@tldraw/store'
import { ITEMS_TO_NOTES_MIGRATION_ID } from '../../properties/itemsToNotes'
import { ROLLUP_NODE_TYPE } from '../rollup/definition'
import { TABLE_NODE_TYPE } from './definition'
import {
	DEFAULT_COLUMN_WIDTH,
	DEFAULT_MAX_ROWS,
	LABEL_COLUMN,
	type SummaryOp,
	type TableColumn,
	type TableNodeProps,
} from './spec'

/**
 * The rollup node's retirement: every `node.rollup` becomes a `node.table` showing the same number.
 *
 * Same mechanism as the item→note migration, and for the same reason: an unregistered shape type is a
 * *validation* failure rather than a stale record, so the repair has to happen before validation. See
 * `properties/itemsToNotes.ts` for the full reasoning.
 *
 * The result is deliberately a table in `value` mode — one big number, exactly what the rollup showed —
 * rather than a grid. A board full of KPIs must not silently turn into a board full of grids on upgrade;
 * switching is now one dropdown away, which is the user's choice to make.
 */
const versions = createMigrationIds('com.lifeboard.rollupsToTables', {
	RollupsToTables: 1,
})

export const ROLLUPS_TO_TABLES_MIGRATION_ID = versions.RollupsToTables

interface LooseRecord {
	typeName?: unknown
	type?: unknown
	props?: Record<string, unknown>
}

/** The old rollup ops, mapped onto summary ops. `count` is the only one that changes name. */
const OP_TO_SUMMARY: Record<string, SummaryOp> = {
	sum: 'sum',
	avg: 'avg',
	min: 'min',
	max: 'max',
	// A rollup's `count` counted matching *nodes*, which is `count`, not `countValues`.
	count: 'count',
}

export const rollupsToTablesMigrations: MigrationSequence = createMigrationSequence({
	sequenceId: 'com.lifeboard.rollupsToTables',
	retroactive: true,
	sequence: [
		{
			// `sortMigrations` orders *independent* sequences heuristically, so the dependency is declared
			// rather than assumed: this must run after items became notes, because that pass is what
			// repoints a rollup's `nodeType` away from the type that no longer exists.
			dependsOn: [ITEMS_TO_NOTES_MIGRATION_ID],
			id: versions.RollupsToTables,
			scope: 'store',
			up(store) {
				for (const record of Object.values(store) as LooseRecord[]) {
					if (record.typeName !== 'shape' || record.type !== ROLLUP_NODE_TYPE) continue
					const old = record.props ?? {}

					const source = (old.source ?? {}) as {
						scope?: unknown
						frameId?: unknown
						nodeType?: unknown
						tags?: unknown
					}
					const agg = (old.agg ?? {}) as { op?: unknown; fieldKey?: unknown; groupBy?: unknown }
					// `props.format` is read by nothing here, on purpose: a table formats a summary from the
					// *property's* registered unit, so a rollup pinning "GEL" over a property already defined in
					// GEL was duplicated truth. Where the two disagreed, the property is what the rest of the
					// app believes, so dropping the rollup's copy resolves the disagreement rather than carrying
					// it forward.
					const propertyId = typeof agg.fieldKey === 'string' && agg.fieldKey ? agg.fieldKey : null
					const summary = OP_TO_SUMMARY[String(agg.op)] ?? 'sum'

					// The aggregated property becomes the one column carrying the summary. A rollup with no
					// property chosen yet has nothing to show, so it gets the name column and a row count —
					// which is at least true, and is what the table's own empty state would say.
					const columns: TableColumn[] = propertyId
						? [{ key: propertyId, summary, width: DEFAULT_COLUMN_WIDTH }]
						: [{ key: LABEL_COLUMN, summary: 'count', width: DEFAULT_COLUMN_WIDTH }]

					// A rollup scoped `tags` selected by tag membership. Tags are a multi-select property now,
					// so that becomes a filter — and `tags` is the well-known id the item migration creates.
					const filters =
						source.scope === 'tags' && Array.isArray(source.tags) && source.tags.length
							? // Only the first tag: the old scope was any-of, and filters are ANDed, so keeping
								// them all would match nothing. One tag preserves the common case; the rest are
								// recoverable by hand, which is better than a table that shows zero rows.
								[{ propertyId: 'tags', op: 'contains' as const, value: String(source.tags[0]) }]
							: []

					const props: TableNodeProps = {
						title: typeof old.title === 'string' ? old.title : 'Table',
						source: {
							shapeTypes:
								typeof source.nodeType === 'string' && source.nodeType ? [source.nodeType] : null,
							// `tags` is not a table scope; the tag selection became a filter above, so the scope
							// collapses to the board.
							scope: source.scope === 'frame' ? 'frame' : 'page',
							frameId: typeof source.frameId === 'string' ? source.frameId : null,
							filters,
						},
						columns,
						groupBy: typeof agg.groupBy === 'string' && agg.groupBy ? agg.groupBy : null,
						sorts: [],
						// One big number, as before. See the note at the top.
						layout: { mode: 'value', maxRows: DEFAULT_MAX_ROWS },
						// No hand-entered rates: a rollup never had any, and an empty map is what a new
						// table starts with, so the converted total means the same thing either way.
						rates: {},
					}

					record.type = TABLE_NODE_TYPE
					record.props = {
						w: numberOr(old.w, 280),
						h: numberOr(old.h, 150),
						...props,
					} as unknown as Record<string, unknown>
				}
			},
		},
	],
})

function numberOr(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}
