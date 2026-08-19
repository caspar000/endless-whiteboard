import { describe, expect, it } from 'vitest'
import type { TLShape, TLShapePartial } from 'tldraw'
import type { PropertyDef } from '../../../properties/types'
import { TABLE_NODE_TYPE } from '../definition'
import { EMPTY_TABLE, type TableGroup, type TableResult } from '../query'
import { DATE_GROUP_PREFIX, defaultTableProps, type TableNodeProps } from '../spec'
import { CALENDAR_METRICS, dayBoxes, rowTop } from './calendarLayout'
import { contentTop, KANBAN_METRICS } from './kanbanLayout'
import { readViewHome, type ViewHome } from './ownership'
import { placementPatches, type PlacementEnv } from './placement'

/**
 * These tests drive `placementPatches` — the pure half — because the reactive half's job is only to
 * hand it a live editor. Everything worth getting wrong is in here: what gets moved, what gets adopted,
 * what gets let go of, and what happens when two views want the same card.
 */

const STATUS: PropertyDef = {
	id: 'status',
	name: 'Status',
	type: 'status',
	options: ['To-do', 'Done'],
}

function kanban(id: string, over: Partial<TableNodeProps> = {}, w = 600, h = 300): TLShape {
	const props = { ...defaultTableProps(), groupBy: 'status', autoHeight: false, ...over }
	props.layout = { ...props.layout, mode: 'kanban', ...(over.layout ?? {}) }
	return {
		id,
		type: TABLE_NODE_TYPE,
		x: 0,
		y: 0,
		meta: {},
		props: { ...props, w, h },
	} as unknown as TLShape
}

/** The same card, showing a calendar: a placing view whose lanes are days. */
function calendar(id: string, over: Partial<TableNodeProps> = {}, w = 1100, h = 300): TLShape {
	const props = { ...defaultTableProps(), groupBy: `${DATE_GROUP_PREFIX}due`, autoHeight: false, ...over }
	// Thursday 13 August 2026, so the week is Mon 10 – Sun 16 and the geometry is not today's.
	props.layout = { ...props.layout, mode: 'calendar', anchor: '2026-08-13', ...(over.layout ?? {}) }
	return {
		id,
		type: TABLE_NODE_TYPE,
		x: 0,
		y: 0,
		meta: {},
		props: { ...props, w, h },
	} as unknown as TLShape
}

function card(id: string, x: number, y: number, home?: ViewHome): TLShape {
	return {
		id,
		type: 'geo',
		x,
		y,
		meta: home ? { 'lifeboard:viewHome': { ...home } } : {},
		props: { w: 100, h: 50 },
	} as unknown as TLShape
}

function group(key: string, shapeIds: string[]): TableGroup {
	return {
		key,
		rows: shapeIds.map((shapeId) => ({ shapeId, label: shapeId, cells: {}, units: {} })),
		summaries: {},
		money: {},
	}
}

function result(...groups: TableGroup[]): TableResult {
	return { ...EMPTY_TABLE, groups, matched: groups.reduce((n, g) => n + g.rows.length, 0) }
}

/**
 * The env, with the two geometry calls answered the simple way: heights come from the shape's props and
 * a view's shape space *is* page space, which is true whenever nothing is rotated or nested.
 */
function env(
	shapes: TLShape[],
	results: Record<string, TableResult>,
	over: Partial<PlacementEnv> = {}
): PlacementEnv {
	return {
		shapes,
		held: new Set(),
		properties: new Map([[STATUS.id, STATUS]]),
		resultFor: (id) => results[id] ?? EMPTY_TABLE,
		heightOf: (shape) => (shape.props as { h: number }).h,
		place: (view, _member, local) => ({ x: view.x + local.x, y: view.y + local.y }),
		...over,
	}
}

/** The position a patch would write, or `undefined` if it does not move the shape. */
function moveOf(patches: TLShapePartial[], id: string): { x?: number; y?: number } | undefined {
	const patch = patches.find((p) => p.id === id && (p.x !== undefined || p.y !== undefined))
	return patch ? { x: patch.x, y: patch.y } : undefined
}

function homeOf(patches: TLShapePartial[], id: string): ViewHome | null | undefined {
	const patch = patches.find((p) => p.id === id && p.meta)
	if (!patch) return undefined
	return readViewHome({ meta: patch.meta as never })
}

describe('placement', () => {
	it('moves a member into its lane and remembers where it came from', () => {
		const view = kanban('shape:view')
		const member = card('shape:a', 900, 900)
		const patches = placementPatches(
			env([view, member], { 'shape:view': result(group('To-do', ['shape:a'])) })
		)

		expect(moveOf(patches, 'shape:a')).toEqual({ x: KANBAN_METRICS.pad, y: contentTop() })
		expect(homeOf(patches, 'shape:a')).toEqual({
			viewId: 'shape:view',
			x: 900,
			y: 900,
			adopted: 'query',
		})
	})

	/**
	 * The property that makes this safe to run on every store change. Without it the effect would write
	 * on every pass, each write would re-trigger it, and the board would never go quiet.
	 */
	it('writes nothing once everything is where it belongs', () => {
		const view = kanban('shape:view')
		const home: ViewHome = { viewId: 'shape:view', x: 900, y: 900, adopted: 'query' }
		const member = card('shape:a', KANBAN_METRICS.pad, contentTop(), home)
		const results = { 'shape:view': result(group('To-do', ['shape:a'])) }

		// The height patch is the only thing outstanding, so settle it first — as the live pass would.
		const first = placementPatches(env([view, member], results))
		expect(moveOf(first, 'shape:a')).toBeUndefined()
		const height = first.find((p) => p.id === 'shape:view')?.props as { h: number } | undefined
		expect(height?.h).toBeGreaterThan(0)

		const settled = kanban('shape:view', {}, 600, height!.h)
		expect(placementPatches(env([settled, member], results))).toEqual([])
	})

	it('sizes the card to its tallest lane', () => {
		const view = kanban('shape:view')
		const patches = placementPatches(
			env([view, card('shape:a', 0, 0), card('shape:b', 0, 0)], {
				'shape:view': result(group('To-do', ['shape:a', 'shape:b'])),
			})
		)
		const props = patches.find((p) => p.id === 'shape:view')?.props as { h: number }
		expect(props.h).toBe(contentTop() + 50 + KANBAN_METRICS.cardGap + 50 + KANBAN_METRICS.pad)
	})

	it('sends a member home when it stops matching', () => {
		const view = kanban('shape:view')
		const home: ViewHome = { viewId: 'shape:view', x: 900, y: 900, adopted: 'query' }
		const patches = placementPatches(
			env([view, card('shape:a', 8, 50, home)], { 'shape:view': EMPTY_TABLE })
		)
		expect(moveOf(patches, 'shape:a')).toEqual({ x: 900, y: 900 })
		expect(homeOf(patches, 'shape:a')).toBeNull()
	})

	/** A card handed over by hand stays where it was put: the view would otherwise overrule a gesture. */
	it('leaves a dropped-in member where it stands when it stops matching', () => {
		const home: ViewHome = { viewId: 'shape:view', x: 900, y: 900, adopted: 'drop' }
		const patches = placementPatches(
			env([kanban('shape:view'), card('shape:a', 8, 50, home)], { 'shape:view': EMPTY_TABLE })
		)
		expect(moveOf(patches, 'shape:a')).toBeUndefined()
		expect(homeOf(patches, 'shape:a')).toBeNull()
	})

	it('lets a member go when its view is deleted', () => {
		const home: ViewHome = { viewId: 'shape:gone', x: 12, y: 34, adopted: 'query' }
		const patches = placementPatches(env([card('shape:a', 500, 500, home)], {}))
		expect(moveOf(patches, 'shape:a')).toEqual({ x: 12, y: 34 })
		expect(homeOf(patches, 'shape:a')).toBeNull()
	})

	it('lets its members go when the view stops grouping', () => {
		const view = kanban('shape:view', { groupBy: null })
		const home: ViewHome = { viewId: 'shape:view', x: 900, y: 900, adopted: 'query' }
		const patches = placementPatches(
			env([view, card('shape:a', 8, 50, home)], {
				'shape:view': result(group('To-do', ['shape:a'])),
			})
		)
		expect(moveOf(patches, 'shape:a')).toEqual({ x: 900, y: 900 })
	})

	/**
	 * The rule that stops two kanbans tearing a card in half. Whoever adopted it first keeps it; the other
	 * draws its lane one card short. Both views match the card here, and the one that owns it is the one
	 * whose lane the card ends up in — which is why the two are a thousand pixels apart.
	 */
	it('leaves a member another view owns to that view', () => {
		const mine = kanban('shape:mine')
		const theirs = { ...kanban('shape:theirs'), x: 1000 } as TLShape
		const home: ViewHome = { viewId: 'shape:theirs', x: 900, y: 900, adopted: 'query' }
		const matched = result(group('To-do', ['shape:a']))
		const patches = placementPatches(
			env([mine, theirs, card('shape:a', 400, 400, home)], {
				'shape:mine': matched,
				'shape:theirs': matched,
			})
		)
		expect(moveOf(patches, 'shape:a')).toEqual({ x: 1000 + KANBAN_METRICS.pad, y: contentTop() })
		// Already owned, so no second home is recorded over the first.
		expect(homeOf(patches, 'shape:a')).toBeUndefined()
	})

	it('leaves a shape alone while it is being dragged, and does not adopt it either', () => {
		const view = kanban('shape:view')
		const patches = placementPatches(
			env([view, card('shape:a', 900, 900)], {
				'shape:view': result(group('To-do', ['shape:a'])),
			}, { held: new Set(['shape:a']) })
		)
		expect(moveOf(patches, 'shape:a')).toBeUndefined()
		expect(homeOf(patches, 'shape:a')).toBeUndefined()
	})

	it('refuses to place another view, a container or a relation', () => {
		const view = kanban('shape:view')
		const other = kanban('shape:other')
		const frame = { ...card('shape:frame', 900, 900), type: 'frame' } as TLShape
		const arrow = { ...card('shape:arrow', 900, 900), type: 'arrow' } as TLShape
		const locked = { ...card('shape:locked', 900, 900), isLocked: true } as TLShape
		const patches = placementPatches(
			env([view, other, frame, arrow, locked], {
				'shape:view': result(group('To-do', ['shape:other', 'shape:frame', 'shape:arrow', 'shape:locked'])),
			})
		)
		for (const id of ['shape:other', 'shape:frame', 'shape:arrow', 'shape:locked']) {
			expect(moveOf(patches, id)).toBeUndefined()
			expect(homeOf(patches, id)).toBeUndefined()
		}
	})

	it('does nothing at all on a board with no placing view', () => {
		const table = kanban('shape:view', { layout: { mode: 'table', maxRows: 12 } })
		expect(placementPatches(env([table, card('shape:a', 900, 900)], {}))).toEqual([])
	})

	it('lays lanes out left to right in the order laneKeys gives them', () => {
		const view = kanban('shape:view')
		const patches = placementPatches(
			env([view, card('shape:a', 0, 0), card('shape:b', 0, 0)], {
				// The query hands Done over first, being the bigger bucket; the stages put To-do left of it.
				'shape:view': result(group('Done', ['shape:b']), group('To-do', ['shape:a'])),
			})
		)
		expect(moveOf(patches, 'shape:a')!.x!).toBeLessThan(moveOf(patches, 'shape:b')!.x!)
	})

	/**
	 * An agent reaches `layout` through `node.configure`, which writes props directly and knows nothing
	 * about `setViewMode` — so a kanban can arrive with the height measurement still switched on. Left
	 * alone, that measurement and this pass disagree by the card's 2px border and grow it forever.
	 */
	it('pins auto-height off on a placing view that arrived without it', () => {
		const view = kanban('shape:view', { autoHeight: true })
		const patches = placementPatches(env([view], { 'shape:view': EMPTY_TABLE }))
		expect((patches.find((p) => p.id === 'shape:view')?.props as { autoHeight: boolean }).autoHeight)
			.toBe(false)
	})

	/**
	 * The invariant the whole design rests on: **position is an output of a view, never an input.**
	 *
	 * `queryTable` reads facts, and facts are the shape's type, parent, label, property values and units
	 * — nothing positional (`facts.ts`). So this pass may write x/y/h and its own ownership sidecar, and
	 * must never touch a property value: if it did, placing a card could change which cards are members,
	 * and the board would rearrange itself forever at sixty frames a second.
	 */
	it('writes nothing the query reads', () => {
		const patches = placementPatches(
			env([kanban('shape:view'), card('shape:a', 900, 900)], {
				'shape:view': result(group('To-do', ['shape:a'])),
			})
		)
		expect(patches.length).toBeGreaterThan(0)
		for (const patch of patches) {
			for (const key of Object.keys(patch)) {
				expect(['id', 'type', 'x', 'y', 'props', 'meta']).toContain(key)
			}
			// `h` and the auto-height pin are geometry; anything else in props would be configuration.
			for (const key of Object.keys(patch.props ?? {})) {
				expect(['h', 'autoHeight']).toContain(key)
			}
			// The ownership sidecar only. `lifeboard:props` is where values live, and writing one here
			// would feed this pass's output back into the query that produced it.
			for (const key of Object.keys(patch.meta ?? {})) {
				expect(key).toBe('lifeboard:viewHome')
			}
		}
	})

	/** One patch per shape: `updateShapes` applies partials against the record as it was, so a card given
	 * both a move and a home in two entries would silently lose one of them. */
	it('merges a move and an adoption into one patch', () => {
		const patches = placementPatches(
			env([kanban('shape:view'), card('shape:a', 900, 900)], {
				'shape:view': result(group('To-do', ['shape:a'])),
			})
		)
		const forCard = patches.filter((p) => p.id === 'shape:a')
		expect(forCard).toHaveLength(1)
		expect(forCard[0]!.x).toBeDefined()
		expect(forCard[0]!.meta).toBeDefined()
	})

	/**
	 * A calendar arranges its members exactly as a kanban does — the pass knows nothing about either, it
	 * asks the view where things go (`ViewDefinition.placement`). What differs is only that the columns
	 * are days and that they wrap into week rows.
	 */
	it('stands a calendar member on its day', () => {
		const view = calendar('shape:view')
		const patches = placementPatches(
			env([view, card('shape:a', 900, 900)], {
				'shape:view': result(group('2026-08-13', ['shape:a'])),
			})
		)
		const thursday = dayBoxes('2026-08-13', 'week', 1100).find((b) => b.day === '2026-08-13')!
		const height = (patches.find((p) => p.id === 'shape:view')?.props as { h: number }).h
		expect(moveOf(patches, 'shape:a')).toEqual({
			x: thursday.x,
			y: rowTop(0, 1, height) + CALENDAR_METRICS.dayHeadHeight,
		})
		expect(homeOf(patches, 'shape:a')).toMatchObject({ adopted: 'query', x: 900, y: 900 })
	})

	it('lays a week out left to right, Monday first', () => {
		const patches = placementPatches(
			env([calendar('shape:view'), card('shape:mon', 0, 0), card('shape:sun', 0, 0)], {
				'shape:view': result(
					group('2026-08-16', ['shape:sun']),
					group('2026-08-10', ['shape:mon'])
				),
			})
		)
		expect(moveOf(patches, 'shape:mon')!.x!).toBeLessThan(moveOf(patches, 'shape:sun')!.x!)
		// One row, so both stand at the same height.
		expect(moveOf(patches, 'shape:mon')!.y).toBe(moveOf(patches, 'shape:sun')!.y)
	})

	it('sends a calendar member home when its date is cleared', () => {
		const home: ViewHome = { viewId: 'shape:view', x: 900, y: 900, adopted: 'query' }
		const patches = placementPatches(
			env([calendar('shape:view'), card('shape:a', 8, 50, home)], { 'shape:view': EMPTY_TABLE })
		)
		expect(moveOf(patches, 'shape:a')).toEqual({ x: 900, y: 900 })
		expect(homeOf(patches, 'shape:a')).toBeNull()
	})
})
