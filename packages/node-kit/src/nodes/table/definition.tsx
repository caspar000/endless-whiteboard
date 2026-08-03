import { T } from 'tldraw'
import { emptyPropsMigrations } from '../../migrations'
import type { NodeDefinition } from '../../registry'
import { TableNodeComponent } from './TableNodeComponent'
import {
	defaultTableProps,
	tableColumnValidator,
	tableLayoutValidator,
	tableSortValidator,
	tableSourceValidator,
	type TableNodeProps,
} from './spec'

/**
 * The table node: a live, read-only view of the shapes on the board.
 *
 * Replaces `node.rollup`, and absorbs it: `layout.mode: 'value'` renders the same single big number the
 * rollup did. One node type rather than two means one spec, one migration and one config UI — and a
 * table that can become a KPI, or the reverse, without recreating anything.
 *
 * Rows are a **read-only mirror**. Editing a cell would mean writing back to a shape from a view, which
 * raises questions about undo, about which shape a grouped row refers to, and about what happens when a
 * filter no longer matches after the edit. Editing the shape is the way to change a value.
 */
export const TABLE_NODE_TYPE = 'node.table'

export type { TableNodeProps }

export const TABLE_MIN_HEIGHT = 72

export const tableNodeDefinition: NodeDefinition<TableNodeProps> = {
	type: TABLE_NODE_TYPE,
	label: 'Table',
	icon: '▦',
	props: {
		title: T.string,
		source: tableSourceValidator,
		columns: T.arrayOf(tableColumnValidator),
		groupBy: T.string.nullable(),
		sorts: T.arrayOf(tableSortValidator),
		layout: tableLayoutValidator,
	},
	// A new type, so there is nothing to migrate *from* yet. The guardrail still applies: the first props
	// change ships a real sequence here.
	migrations: emptyPropsMigrations(),
	defaultProps: defaultTableProps,
	defaultSize: { w: 360, h: 220 },
	// The card sizes itself to the rows it shows. A table whose height is unrelated to its content is
	// either clipping data or padding empty space, and both look broken.
	autoHeight: { minHeight: TABLE_MIN_HEIGHT },
	component: TableNodeComponent,
	canEdit: true,
	// Only consulted for the shape being *edited* (tldraw's `useGestureEvents` checks
	// `getEditingShapeId`), so this is what lets a table with more rows than it shows be scrolled once
	// you double-click into it — it cannot and does not affect display mode.
	canScroll: true,
	getLabel: (shape) => shape.props.title,
	// No `extractValues`: a view contributes no values, which is what makes table-of-table cycles
	// impossible.
}
