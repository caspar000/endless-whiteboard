import { Table } from 'lucide-react'
import { T } from 'tldraw'
import { defineNode, type Extension } from '../../extensions'
import { createShapePropsMigrationIds, createShapePropsMigrationSequence } from '../../migrations'
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

const versions = createShapePropsMigrationIds('node.table', { AddRates: 1 })

export const TABLE_MIN_HEIGHT = 72

export const tableNodeDefinition: NodeDefinition<TableNodeProps> = {
	type: TABLE_NODE_TYPE,
	label: 'Table',
	icon: '▦',
	toolbarIcon: Table,
	props: {
		title: T.string,
		source: tableSourceValidator,
		columns: T.arrayOf(tableColumnValidator),
		groupBy: T.string.nullable(),
		sorts: T.arrayOf(tableSortValidator),
		layout: tableLayoutValidator,
		// Hand-entered rates, against the display currency. Values are validated as positive numbers so
		// a junk entry can never poison a total.
		rates: T.dict(T.string, T.positiveNumber),
	},
	// A new type, so there is nothing to migrate *from* yet. The guardrail still applies: the first props
	// change ships a real sequence here.
	/**
	 * `rates` was added when currency conversion arrived. Existing tables get an empty map, which means
	 * "no hand-entered rates" — the same thing a new table starts with — so nothing about how they
	 * already total changes.
	 */
	migrations: createShapePropsMigrationSequence({
		sequence: [
			{
				id: versions.AddRates,
				up(props) {
					props.rates = {}
				},
			},
		],
	}),
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

/**
 * The table, packaged as an extension so it is toggleable like any other. Exported from node-kit
 * (rather than wrapped app-side) because the definition lives here; the app still decides whether to
 * register it — node-kit self-registers nothing but the deprecated legacy types.
 */
export const tablesExtension: Extension = {
	id: 'lifeboard.tables',
	name: 'Tables',
	description: 'A live, read-only table view of the shapes on the board — grouping, filters and totals.',
	details: [
		'Adds the table: a card that asks the board a question and shows the answer as rows. It reads the shapes that are already there — nothing is copied into it, so a table can never drift out of date with what it describes.',
		'Choose the columns from the board’s properties, filter and group the rows, and put a total at the foot of any numeric column. Narrow it down far enough and a table becomes one big number, which is often all you wanted.',
		'Turning this off removes the table tool and its menu entries. Tables already on your boards keep rendering and stay live.',
	],
	icon: Table,
	version: '0.1.0',
	author: 'Lifeboard',
	nodes: [defineNode(tableNodeDefinition)],
}
