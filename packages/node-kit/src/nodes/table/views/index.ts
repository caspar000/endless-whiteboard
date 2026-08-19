import type { ComponentType } from 'react'
import type { PropertyDef } from '../../../properties/types'
import type { DropTarget } from '../../../registry'
import { EMPTY_GROUP_KEY, type TableResult } from '../query'
import {
	DEFAULT_COLUMN_WIDTH,
	LABEL_COLUMN,
	DATE_GROUP_PREFIX,
	dateGroupProperty,
	type LayoutMode,
	type TableColumn,
	type TableNodeProps,
} from '../spec'
import { CalendarView } from './calendar'
import {
	calendarAnchor,
	calendarSlots,
	calendarSpan,
	calendarWidth,
	dayAt,
	dayBoxes,
} from './calendarLayout'
import { KanbanView } from './kanban'
import { KANBAN_METRICS, kanbanSlots, laneAt, laneBoxes, type LaneMember } from './kanbanLayout'
import { laneKeys, laneProperty } from './lanes'
import type { ViewProps } from './shared'
import { TableView } from './table'
import { headlineColumn, ValueView } from './value'

/**
 * One way of drawing the answer to a board's question — the **ViewSpec** of the lens described in
 * `docs/views-plan.md`, where a lens is `QuerySpec + ViewSpec + InteractionSpec`.
 *
 * The QuerySpec is `TableSource` + `groupBy` + `sorts` and is shared by every view: "what counts" is
 * one question whatever you do with the answer, which is the same reasoning that made a collection a
 * thing any shape can do rather than a second engine. So a view never selects; it is handed a
 * `TableResult` and decides what that looks like.
 *
 * This is a table rather than a branch in the component so that adding a view is one entry here plus
 * one member of `LAYOUT_MODES` — the rule the node and command registries already follow. Views are a
 * fixed, first-party set (a plain array, no registration API): a plugin-supplied view would need the
 * geometry and interaction seams too, and inventing that API before there is a second author for it
 * would be guessing.
 */
export interface ViewDefinition {
	mode: LayoutMode
	/** How the view is named in the config switcher and its ⌘K command: "Show as a table". */
	label: string
	component: ComponentType<ViewProps>
	/**
	 * Why this view cannot draw with the configuration it has been given — "Pick a column summary to
	 * show a total". `null` when it is ready.
	 *
	 * Deliberately about the *configuration*, not the result. "Nothing matches yet" is a true and
	 * useful thing for a view to say about a board, so it stays inside the view; "you have not told me
	 * which property makes the lanes" is a thing the view cannot draw around at all, and the dispatcher
	 * shows it in place of the view. Keeping the two apart is what stops an empty board from looking
	 * like a broken table.
	 */
	blockedReason?(
		props: TableNodeProps,
		properties: ReadonlyMap<string, PropertyDef>
	): string | null
	/**
	 * Whether this view moves its members into position on the board.
	 *
	 * `false` for a readout: a table *describes* shapes, a kanban *arranges* them, and only the second
	 * kind may write x/y. What acts on this is `placement.ts` — and the invariant it must keep is that
	 * position stays an output, never an input to the query.
	 *
	 * A placing view also owns its card's height, so switching to one turns `autoHeight` off
	 * (`mode.ts`).
	 */
	placesMembers?: boolean
	/**
	 * The whole card, rather than a body under the node's own header.
	 *
	 * For a view whose geometry has to line up with shapes outside its DOM. The kanban draws its own
	 * title strip so that the distance from the card's top edge to the first card in a lane is a number
	 * it chose (`KANBAN_METRICS`) rather than the sum of a padding, a header's line-height and a flex
	 * gap — which is what the shared chrome is, and it would move every card on the board the next time
	 * anyone touched the stylesheet.
	 */
	fills?: boolean
	/**
	 * The columns to *query* with, when they are not the ones the user picked.
	 *
	 * This exists for one hazard. `queryTable`'s row-membership rule is "carry at least one of the
	 * table's column properties", and it keeps every match when there are no property columns at all —
	 * which is right for a table showing a plain list of names, and catastrophic for a view that then
	 * physically files every drawing, frame and stray note on the page into a lane. A kanban therefore
	 * queries with its group property as a column, which turns membership into "carries a Status".
	 *
	 * `null` means "the user's columns", which is what every readout returns.
	 */
	columnsFor?(props: TableNodeProps): TableColumn[] | null
	/**
	 * Where this view wants its members to stand, and how tall that makes the card.
	 *
	 * The other half of `placesMembers`: the flag says *whether* a view arranges shapes, this says
	 * *where*. It exists so `placement.ts` knows nothing about lanes or days — it decides which shapes
	 * may be moved (ownership, locks, what is in hand), groups them by the key the query bucketed them
	 * under, and asks the view for coordinates.
	 *
	 * `membersByKey` is keyed as the query grouped them: a lane value for a kanban, an ISO day for a
	 * calendar. Members arrive in the order the query sorted them, already filtered to the ones this
	 * pass is allowed to move.
	 */
	placement?(ctx: {
		props: TableNodeProps
		properties: ReadonlyMap<string, PropertyDef>
		result: TableResult
		width: number
		membersByKey: ReadonlyMap<string, readonly LaneMember[]>
	}): { slots: Map<string, { x: number; y: number }>; height: number } | null
	/**
	 * The settings this view needs before it can draw anything, filled in when a card is switched to it.
	 *
	 * A view that lands saying "group by a date to show a calendar" has technically done the right thing
	 * and practically wasted the user's time: there is one date property on the board, and it is the one
	 * they meant. So the view picks, and only when the current configuration cannot work — a kanban
	 * already grouped by Status keeps it.
	 *
	 * Returns a props patch merged into the switch's own write, so it is part of the same undo entry.
	 * `null` for a view that is ready however it is configured.
	 */
	prepare?(ctx: {
		props: TableNodeProps
		properties: readonly PropertyDef[]
	}): Partial<TableNodeProps> | null
	/**
	 * How wide this view asks to be when a card is first switched to it.
	 *
	 * A placing view divides its width into columns, so the card has to arrive wide enough to hold them:
	 * seven days in a 360px table would give each one fifty pixels and every card standing on it would
	 * overhang. Only ever used to widen — shrinking a card the user has sized is not a switch's business.
	 */
	defaultWidth?(props: TableNodeProps): number
	/**
	 * What a point on this view means to a card dropped there — the view's half of the InteractionSpec.
	 *
	 * A view knows its own geometry, so it is the only thing that can answer this: the kanban divides the
	 * card into lanes and writes a status, the calendar divides it into days and writes a date. Returning
	 * `null` is a miss (the title strip, the gap outside a month's grid), and a miss does nothing rather
	 * than guessing.
	 *
	 * `local` is in **shape space**, which is what makes this testable without an editor: the factory has
	 * already converted the cursor's page point through the shape's own transform.
	 */
	dropAt?(ctx: {
		props: TableNodeProps
		properties: ReadonlyMap<string, PropertyDef>
		result: TableResult
		local: { x: number; y: number }
		width: number
		height: number
	}): DropTarget | null
}

const VIEWS: readonly ViewDefinition[] = [
	{
		mode: 'table',
		label: 'a table',
		component: TableView,
	},
	{
		mode: 'value',
		label: 'one big number',
		component: ValueView,
		blockedReason: (props) =>
			headlineColumn(props.columns, props.layout.valueColumn)
				? null
				: 'Pick a column summary to show a total',
	},
	{
		mode: 'kanban',
		label: 'a kanban',
		component: KanbanView,
		placesMembers: true,
		fills: true,
		blockedReason: (props) =>
			laneProperty(props) ? null : 'Group by a property to make lanes',
		// Membership becomes "carries the lane property" — see `columnsFor` above for why the alternative
		// is a view that files the whole board. The label column earns its place for the same reason it
		// does in a collection: without it a shape carrying the property but nothing else is not a row.
		columnsFor: (props) => {
			const lane = laneProperty(props)
			if (!lane) return null
			return [
				{ key: LABEL_COLUMN, summary: null, width: DEFAULT_COLUMN_WIDTH },
				{ key: lane, summary: null, width: DEFAULT_COLUMN_WIDTH },
			]
		},
		placement: ({ props, properties, result, width, membersByKey }) => {
			const lane = laneProperty(props)
			if (!lane) return null
			const keys = laneKeys(properties.get(lane) ?? null, result.groups, props.layout.lanes)
			return kanbanSlots(laneBoxes(keys, width), membersByKey)
		},
		defaultWidth: (props) =>
			// Three lanes' worth, which is the shape of every kanban anybody draws by hand; a stored lane
			// order beats the guess whenever there is one.
			(props.layout.lanes?.length || 3) * KANBAN_METRICS.defaultLaneWidth + KANBAN_METRICS.pad * 2,
		prepare: ({ props, properties }) => {
			// Already grouped by something that makes lanes — that is the user's choice, not ours to redo.
			if (laneProperty(props)) return null
			// A `status` first: its options carry stages, so the lanes come out in to-do → doing → done order
			// rather than alphabetically. A plain `select` is the next best thing.
			const found =
				properties.find((def) => def.type === 'status') ??
				properties.find((def) => def.type === 'select')
			return found ? { groupBy: found.id } : null
		},
		dropAt: ({ props, properties, result, local, width }) => {
			const lane = laneProperty(props)
			if (!lane) return null
			const keys = laneKeys(properties.get(lane) ?? null, result.groups, props.layout.lanes)
			const key = laneAt(laneBoxes(keys, width), local)
			if (key === null) return null
			// The empty lane stands for an absence, so it writes one rather than storing its own label as a
			// value — which would put the card in a state no picker offers.
			return { key, values: { [lane]: key === EMPTY_GROUP_KEY ? null : key } }
		},
	},
	{
		mode: 'calendar',
		label: 'a calendar',
		component: CalendarView,
		// A calendar is a kanban whose lanes are days: it stands the real cards on the days they are due,
		// so a week is somewhere work can be moved around rather than a picture of it.
		placesMembers: true,
		fills: true,
		blockedReason: (props) =>
			dateGroupProperty(props.groupBy) ? null : 'Group by a date to show a calendar',
		columnsFor: (props) => {
			const day = dateGroupProperty(props.groupBy)
			if (!day) return null
			// Membership becomes "carries the date property", for the same reason the kanban does it — see
			// `columnsFor` above.
			return [
				{ key: LABEL_COLUMN, summary: null, width: DEFAULT_COLUMN_WIDTH },
				{ key: day, summary: null, width: DEFAULT_COLUMN_WIDTH },
			]
		},
		placement: ({ props, width, membersByKey }) => {
			if (!dateGroupProperty(props.groupBy)) return null
			const boxes = dayBoxes(calendarAnchor(props.layout), calendarSpan(props.layout), width)
			return calendarSlots(boxes, membersByKey)
		},
		defaultWidth: () => calendarWidth(),
		prepare: ({ props, properties }) => {
			const patch: Partial<TableNodeProps> = {}
			if (!dateGroupProperty(props.groupBy)) {
				const found = properties.find((def) => def.type === 'date')
				if (!found) return null
				// The `date:` grouping, which buckets by *day* — the calendar's own lanes. Grouping by the raw
				// property would bucket by the stored string, which for a date with a time on it is one bucket
				// per timestamp.
				patch.groupBy = `${DATE_GROUP_PREFIX}${found.id}`
			}
			/*
			 * The span is written out rather than left implied.
			 *
			 * `calendarSpan` already answers "week" for an absent value, so this changes nothing about what is
			 * drawn — but `node.config` reports what is *stored*, and an agent reading a calendar back should
			 * see the span it is showing rather than have to know the default. The anchor is deliberately left
			 * absent, which is what makes the card follow today (see `calendarAnchor`).
			 */
			if (props.layout.span === undefined) {
				patch.layout = { ...props.layout, span: 'week' }
			}
			return Object.keys(patch).length ? patch : null
		},
		dropAt: ({ props, local, width, height }) => {
			const day = dateGroupProperty(props.groupBy)
			if (!day) return null
			const boxes = dayBoxes(calendarAnchor(props.layout), calendarSpan(props.layout), width)
			const key = dayAt(boxes, height, local)
			// Days outside the month are still days, and a card dropped on one is due on it: the grid draws
			// them dimmed rather than refusing them, so the drop follows.
			return key === null ? null : { key, values: { [day]: key } }
		},
	},
]

/** Every view, in the order they are offered. */
export function getViewDefinitions(): readonly ViewDefinition[] {
	return VIEWS
}

/**
 * The view for a mode, or `undefined`.
 *
 * `undefined` is reachable only from data the validator should have rejected — a board written by a
 * future version, say — so callers fall back rather than throw. A node that renders nothing is
 * recoverable by switching the view; a node that throws takes the board down.
 */
export function getViewDefinition(mode: LayoutMode): ViewDefinition | undefined {
	return VIEWS.find((view) => view.mode === mode)
}

export type { ViewProps }
