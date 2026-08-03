import { describe, expect, it } from 'vitest'
import type { FactsMap, ShapeFacts } from '../../facts'
import type { PropertyDef, PropertyValue } from '../../properties/types'
import { aggregate, formatRollupValue, type RollupAgg, type RollupSource } from './aggregate'

const ITEM = 'node.item'

/**
 * The board's property registry. Aggregation is registry-aware since Phase 2: numeric-ness and unit
 * come from the *definition*, not from the value, so a text property holding "12" can never be summed
 * and the unit can't disagree with itself across shapes.
 */
const REGISTRY = new Map<string, PropertyDef>([
	['price', { id: 'price', name: 'Price', type: 'currency', unit: 'GEL' }],
	['category', { id: 'category', name: 'Category', type: 'select' }],
	['year', { id: 'year', name: 'Year', type: 'number' }],
	['weight', { id: 'weight', name: 'Weight', type: 'number', unit: 'kg' }],
	['tags', { id: 'tags', name: 'Tags', type: 'multiSelect' }],
])

function item(
	id: string,
	values: Record<string, PropertyValue>,
	opts: { tags?: string[]; parentId?: string | null } = {}
): [string, ShapeFacts] {
	return [
		id,
		{
			type: ITEM,
			parentId: opts.parentId ?? null,
			label: id,
			values: opts.tags ? { ...values, tags: opts.tags } : values,
		},
	]
}

/** The shopping board from §9: three items with ₾ prices and categories. */
function shoppingBoard(): FactsMap {
	return new Map([
		item('desk', { price: 2399, category: 'desk' }, { tags: ['furniture'] }),
		item('chair', { price: 850, category: 'desk' }, { tags: ['furniture'] }),
		item('lamp', { price: 120, category: 'lighting' }, { tags: ['decor'] }),
	])
}

const pageScope: RollupSource = { scope: 'page', frameId: null, tags: [], nodeType: ITEM }
const sumPrice: RollupAgg = { op: 'sum', fieldKey: 'price', groupBy: null }

describe('aggregate — operations', () => {
	it('sums a currency field across the board', () => {
		const result = aggregate(shoppingBoard(), pageScope, sumPrice, 'rollup1', REGISTRY)
		expect(result.total).toBe(3369)
		expect(result.matched).toBe(3)
		expect(result.skipped).toBe(0)
	})

	it('counts nodes regardless of field values', () => {
		const facts = new Map([...shoppingBoard(), item('mystery', {})])
		const result = aggregate(
			facts,
			pageScope,
			{ op: 'count', fieldKey: null, groupBy: null },
			'r',
			REGISTRY
		)
		expect(result.total).toBe(4)
	})

	it('computes avg, min and max', () => {
		const facts = shoppingBoard()
		expect(aggregate(facts, pageScope, { ...sumPrice, op: 'avg' }, 'r', REGISTRY).total).toBe(1123)
		expect(aggregate(facts, pageScope, { ...sumPrice, op: 'min' }, 'r', REGISTRY).total).toBe(120)
		expect(aggregate(facts, pageScope, { ...sumPrice, op: 'max' }, 'r', REGISTRY).total).toBe(2399)
	})

	it('returns zero rather than NaN for an empty selection', () => {
		const result = aggregate(new Map(), pageScope, sumPrice, 'r', REGISTRY)
		expect(result.total).toBe(0)
		expect(result.rows).toEqual([])
		expect(result.matched).toBe(0)
	})

	it('does not match a shape that lacks the aggregated property at all', () => {
		// The counters changed meaning in Phase 2, and had to. Facts now cover *every* shape on the
		// board, so a page-scoped sum(price) used to report `matched: 500, skipped: 480` — which reads
		// as "480 things are missing a price" when 480 of them are arrows and scribbles. Not carrying
		// the property is now simply not being part of the aggregation.
		const facts = new Map([...shoppingBoard(), item('gift', { category: 'desk' })])
		const result = aggregate(facts, pageScope, sumPrice, 'r', REGISTRY)
		expect(result.total).toBe(3369)
		expect(result.matched).toBe(3)
		expect(result.skipped).toBe(0)
	})

	it('reports a shape that carries the property with an unusable value as skipped', () => {
		// This is what `skipped` means now: "has a price, but I can't add it up" — the signal that
		// drives "3 items have no price yet" rather than a silently wrong total.
		const facts = new Map([...shoppingBoard(), item('gift', { price: null })])
		const result = aggregate(facts, pageScope, sumPrice, 'r', REGISTRY)
		expect(result.total).toBe(3369)
		expect(result.matched).toBe(4)
		expect(result.skipped).toBe(1)
	})

	it('refuses to sum a value whose registered type is not numeric', () => {
		// The registry is what makes this possible: the value is a number, but `category` is a select,
		// so it cannot contribute to a total no matter what it holds.
		const facts = new Map([item('odd', { category: 500 })])
		const result = aggregate(facts, pageScope, { ...sumPrice, fieldKey: 'category' }, 'r', REGISTRY)
		expect(result.total).toBe(0)
		expect(result.matched).toBe(1)
		expect(result.skipped).toBe(1)
	})

	it('skips non-numeric values in a numeric aggregation', () => {
		const facts = new Map([...shoppingBoard(), item('odd', { price: 'free' })])
		const result = aggregate(facts, pageScope, sumPrice, 'r', REGISTRY)
		expect(result.total).toBe(3369)
		expect(result.skipped).toBe(1)
	})

	it('reports every match as skipped when no field is chosen yet', () => {
		const result = aggregate(
			shoppingBoard(),
			pageScope,
			{ op: 'sum', fieldKey: null, groupBy: null },
			'r',
			REGISTRY
		)
		expect(result.total).toBe(0)
		expect(result.matched).toBe(3)
		expect(result.skipped).toBe(3)
	})
})

describe('aggregate — grouping', () => {
	it('groups by a field and sorts largest first', () => {
		const result = aggregate(
			shoppingBoard(),
			pageScope,
			{ ...sumPrice, groupBy: 'category' },
			'r',
			REGISTRY
		)
		expect(result.rows).toEqual([
			{ group: 'desk', value: 3249, count: 2 },
			{ group: 'lighting', value: 120, count: 1 },
		])
		expect(result.total).toBe(3369)
	})

	it('buckets items with no group value under an em dash', () => {
		const facts = new Map([...shoppingBoard(), item('misc', { price: 30 })])
		const result = aggregate(facts, pageScope, { ...sumPrice, groupBy: 'category' }, 'r', REGISTRY)
		expect(result.rows.map((r) => r.group)).toContain('—')
	})

	it('coerces non-string group values to strings', () => {
		const facts = new Map([
			item('a', { price: 5, year: 2026 }),
			item('b', { price: 5, year: 2026 }),
		])
		const result = aggregate(facts, pageScope, { ...sumPrice, groupBy: 'year' }, 'r', REGISTRY)
		expect(result.rows).toEqual([{ group: '2026', value: 10, count: 2 }])
	})
})

describe('aggregate — source scoping', () => {
	it('matches any of the selected tags', () => {
		const result = aggregate(
			shoppingBoard(),
			{ scope: 'tags', frameId: null, tags: ['furniture'], nodeType: ITEM },
			sumPrice,
			'r',
			REGISTRY
		)
		expect(result.total).toBe(3249)
		expect(result.matched).toBe(2)
	})

	it('matches nothing when a tag scope has no tags selected', () => {
		const result = aggregate(
			shoppingBoard(),
			{ scope: 'tags', frameId: null, tags: [], nodeType: ITEM },
			sumPrice,
			'r',
			REGISTRY
		)
		expect(result.matched).toBe(0)
	})

	it('scopes by frame parenting, not geometry', () => {
		const facts = new Map([
			item('a', { price: 100 }, { parentId: 'shape:frame1' }),
			item('b', { price: 200 }, { parentId: 'shape:frame2' }),
			item('c', { price: 400 }, { parentId: null }),
		])
		const result = aggregate(
			facts,
			{ scope: 'frame', frameId: 'shape:frame1', tags: [], nodeType: ITEM },
			sumPrice,
			'r',
			REGISTRY
		)
		expect(result.total).toBe(100)
	})

	it('matches nothing when a frame scope has no frame chosen', () => {
		const result = aggregate(
			shoppingBoard(),
			{ scope: 'frame', frameId: null, tags: [], nodeType: ITEM },
			sumPrice,
			'r',
			REGISTRY
		)
		expect(result.matched).toBe(0)
	})

	it('filters by node type', () => {
		const facts = new Map([
			...shoppingBoard(),
			['note1', { ...item('n', { price: 999 })[1], type: 'other.node' }] as [string, ShapeFacts],
		])
		const result = aggregate(facts, pageScope, sumPrice, 'r', REGISTRY)
		expect(result.total).toBe(3369)
	})

	it('includes every node type when nodeType is null', () => {
		const facts = new Map([
			...shoppingBoard(),
			['note1', { ...item('n', { price: 1 })[1], type: 'other.node' }] as [string, ShapeFacts],
		])
		const result = aggregate(facts, { ...pageScope, nodeType: null }, sumPrice, 'r', REGISTRY)
		expect(result.total).toBe(3370)
	})

	it('never counts itself, even when it would otherwise match', () => {
		// Guards the feedback loop that would appear the moment rollups gain `extractFacts`.
		const facts = new Map([...shoppingBoard(), item('rollup1', { price: 10_000 })])
		const result = aggregate(facts, pageScope, sumPrice, 'rollup1', REGISTRY)
		expect(result.total).toBe(3369)
		expect(result.matched).toBe(3)
	})
})

describe('formatRollupValue', () => {
	it('formats currency using the rollup unit when set', () => {
		expect(formatRollupValue(3369, { style: 'currency', unit: 'USD' }, 'GEL')).toBe('$3,369')
	})

	it('falls back to the unit inferred from the source items', () => {
		expect(formatRollupValue(3369, { style: 'currency' }, 'GEL')).toBe('₾3,369')
	})

	it('formats plain numbers without a symbol', () => {
		expect(formatRollupValue(3369, { style: 'number' }, 'GEL')).toBe('3,369')
	})
})
