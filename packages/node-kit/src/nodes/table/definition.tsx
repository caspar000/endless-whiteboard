import { Table } from 'lucide-react'
import { T, type TLShape } from 'tldraw'
import { defineNode, type Extension } from '../../extensions'
import { createShapePropsMigrationIds, createShapePropsMigrationSequence } from '../../migrations'
import type { NodeDefinition } from '../../registry'
import { TableNodeComponent } from './TableNodeComponent'
import { viewCommands } from './views/commands'
import { setDropHint } from './views/dropHint'
import { acceptsViewDrop, applyViewDrop, viewDropTarget } from './views/interaction'
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
		// Optional, so every table persisted before the kanban existed reads as "on" — which is what it
		// was. Only a placing view turns it off; see `TableNodeProps.autoHeight`.
		autoHeight: T.boolean.optional(),
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
	/**
	 * Dropping a card on a lane sets its status — the InteractionSpec half of a view.
	 *
	 * Declared on the definition rather than reached for from inside the component, because it is the
	 * *shape* that receives a drop, not its HTML: a node in display mode has `pointer-events: none`, so a
	 * card drawn inside one could not have been dragged at all without double-clicking in first. Placing
	 * real shapes is what sidesteps that, and this is the other side of the same bargain.
	 */
	drop: {
		// Only a view that arranges its members has anywhere to put a dropped card. A plain table
		// answering `false` also keeps it out of tldraw's paste-reparenting candidates.
		accepts: ({ shape }) => acceptsViewDrop(shape),
		targetAt: ({ editor, shape, point }) =>
			viewDropTarget(editor, shape as unknown as TLShape, point),
		apply: ({ editor, shape, shapes, target }) =>
			applyViewDrop(editor, shape as unknown as TLShape, shapes, target),
		hover: ({ shape, target }) => setDropHint(shape.id, target?.key ?? null),
	},
	getLabel: (shape) => shape.props.title,
	// No `extractValues`: a view contributes no values, which is what makes table-of-table cycles
	// impossible.
}

/**
 * The table, packaged as an extension so it is toggleable like any other. Exported from node-kit
 * (rather than wrapped app-side) because the definition lives here; the app still decides whether to
 * register it — node-kit self-registers nothing but the deprecated legacy types.
 *
 * The **id stays `lifeboard.tables`** although the thing is growing views beyond the table: enablement
 * is persisted against the id, so renaming it would silently re-enable the extension for anyone who had
 * switched it off. Names and copy are free to change; ids are not.
 */
export const tablesExtension: Extension = {
	id: 'lifeboard.tables',
	name: 'Tables & views',
	description:
		'Live views of the shapes on the board — a table, one big number, a kanban, or a calendar that stands your cards on their days.',
	details: [
		'Adds the view: a card that asks the board a question and shows the answer. It reads the shapes that are already there — nothing is copied into it, so a view can never drift out of date with what it describes.',
		'Choose the columns from the board’s properties, filter and group the rows, and put a total at the foot of any numeric column. Narrow it down far enough and a table becomes one big number, which is often all you wanted — the same card, showing a different view of the same question.',
		'Group by a status and switch to a kanban, or by a date and switch to a calendar, and the view stops describing your cards and starts arranging them: the things in the lanes are the real stickies and notes, moved there for you. Drag one into another lane to change its status; change the status anywhere else and the card crosses the board by itself. Drag it out and the property is removed, which is how something leaves a board.',
		'Switch view from the card’s own panel or from ⌘K, with the card selected.',
		'Turning this off removes the view tool and its menu entries. Views already on your boards keep rendering and stay live — including the cards they have arranged, which stay where they are.',
	],
	icon: Table,
	version: '0.1.0',
	author: 'Lifeboard',
	nodes: [defineNode(tableNodeDefinition)],
	// One "Show as …" per registered view, so a view added in `views/index.ts` reaches ⌘K without an
	// edit here — the same registry-driven rule the dock and the create menu follow for node types.
	commands: viewCommands(TABLE_NODE_TYPE),
}
