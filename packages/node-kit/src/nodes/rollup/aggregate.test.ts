import { describe, expect, it } from 'vitest'
import type { FactsMap, NodeFacts } from '../../facts'
import { aggregate, formatRollupValue, type RollupAgg, type RollupSource } from './aggregate'

const ITEM = 'node.item'

function item(
	id: string,
	fields: Record<string, string | number | boolean | null>,
	opts: { tags?: string[]; parentId?: string | null; units?: Record<string, string> } = {}
): [string, NodeFacts] {
	return [
		id,
		{
			type: ITEM,
			parentId: opts.parentId ?? null,
			tags: opts.tags ?? [],
			fields,
			units: opts.units ?? {},
			label: id,
		},
	]
}

/** The shopping board from §9: three items with ₾ prices and categories. */
function shoppingBoard(): FactsMap {
	return new Map([
		item('desk', { price: 2399, category: 'desk' }, { tags: ['furniture'], units: { price: 'GEL' } }),
		item('chair', { price: 850, category: 'desk' }, { tags: ['furniture'], units: { price: 'GEL' } }),
		item('lamp', { price: 120, category: 'lighting' }, { tags: ['decor'], units: { price: 'GEL' } }),
	])
}

const pageScope: RollupSource = { scope: 'page', frameId: null, tags: [], nodeType: ITEM }
const sumPrice: RollupAgg = { op: 'sum', fieldKey: 'price', groupBy: null }

describe('aggregate — operations', () => {
	it('sums a currency field across the board', () => {
		const result = aggregate(shoppingBoard(), pageScope, sumPrice, 'rollup1')
		expect(result.total).toBe(3369)
		expect(result.matched).toBe(3)
		expect(result.skipped).toBe(0)
	})

	it('counts nodes regardless of field values', () => {
		const facts = new Map([...shoppingBoard(), item('mystery', {})])
		const result = aggregate(facts, pageScope, { op: 'count', fieldKey: null, groupBy: null }, 'r')
		expect(result.total).toBe(4)
	})

	it('computes avg, min and max', () => {
		const facts = shoppingBoard()
		expect(aggregate(facts, pageScope, { ...sumPrice, op: 'avg' }, 'r').total).toBe(1123)
		expect(aggregate(facts, pageScope, { ...sumPrice, op: 'min' }, 'r').total).toBe(120)
		expect(aggregate(facts, pageScope, { ...sumPrice, op: 'max' }, 'r').total).toBe(2399)
	})

	it('returns zero rather than NaN for an empty selection', () => {
		const result = aggregate(new Map(), pageScope, sumPrice, 'r')
		expect(result.total).toBe(0)
		expect(result.rows).toEqual([])
		expect(result.matched).toBe(0)
	})

	it('reports items missing the aggregated field as skipped, not as zero', () => {
		const facts = new Map([...shoppingBoard(), item('gift', { category: 'desk' })])
		const result = aggregate(facts, pageScope, sumPrice, 'r')
		expect(result.total).toBe(3369)
		expect(result.matched).toBe(4)
		expect(result.skipped).toBe(1)
	})

	it('skips non-numeric values in a numeric aggregation', () => {
		const facts = new Map([...shoppingBoard(), item('odd', { price: 'free' })])
		const result = aggregate(facts, pageScope, sumPrice, 'r')
		expect(result.total).toBe(3369)
		expect(result.skipped).toBe(1)
	})

	it('reports every match as skipped when no field is chosen yet', () => {
		const result = aggregate(shoppingBoard(), pageScope, { op: 'sum', fieldKey: null, groupBy: null }, 'r')
		expect(result.total).toBe(0)
		expect(result.matched).toBe(3)
		expect(result.skipped).toBe(3)
	})
})

describe('aggregate — grouping', () => {
	it('groups by a field and sorts largest first', () => {
		const result = aggregate(shoppingBoard(), pageScope, { ...sumPrice, groupBy: 'category' }, 'r')
		expect(result.rows).toEqual([
			{ group: 'desk', value: 3249, count: 2 },
			{ group: 'lighting', value: 120, count: 1 },
		])
		expect(result.total).toBe(3369)
	})

	it('buckets items with no group value under an em dash', () => {
		const facts = new Map([...shoppingBoard(), item('misc', { price: 30 })])
		const result = aggregate(facts, pageScope, { ...sumPrice, groupBy: 'category' }, 'r')
		expect(result.rows.map((r) => r.group)).toContain('—')
	})

	it('coerces non-string group values to strings', () => {
		const facts = new Map([item('a', { price: 5, year: 2026 }), item('b', { price: 5, year: 2026 })])
		const result = aggregate(facts, pageScope, { ...sumPrice, groupBy: 'year' }, 'r')
		expect(result.rows).toEqual([{ group: '2026', value: 10, count: 2 }])
	})
})

describe('aggregate — source scoping', () => {
	it('matches any of the selected tags', () => {
		const result = aggregate(
			shoppingBoard(),
			{ scope: 'tags', frameId: null, tags: ['furniture'], nodeType: ITEM },
			sumPrice,
			'r'
		)
		expect(result.total).toBe(3249)
		expect(result.matched).toBe(2)
	})

	it('matches nothing when a tag scope has no tags selected', () => {
		const result = aggregate(
			shoppingBoard(),
			{ scope: 'tags', frameId: null, tags: [], nodeType: ITEM },
			sumPrice,
			'r'
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
			'r'
		)
		expect(result.total).toBe(100)
	})

	it('matches nothing when a frame scope has no frame chosen', () => {
		const result = aggregate(
			shoppingBoard(),
			{ scope: 'frame', frameId: null, tags: [], nodeType: ITEM },
			sumPrice,
			'r'
		)
		expect(result.matched).toBe(0)
	})

	it('filters by node type', () => {
		const facts = new Map([...shoppingBoard(), ['note1', { ...item('n', { price: 999 })[1], type: 'other.node' }] as [string, NodeFacts]])
		const result = aggregate(facts, pageScope, sumPrice, 'r')
		expect(result.total).toBe(3369)
	})

	it('includes every node type when nodeType is null', () => {
		const facts = new Map([...shoppingBoard(), ['note1', { ...item('n', { price: 1 })[1], type: 'other.node' }] as [string, NodeFacts]])
		const result = aggregate(facts, { ...pageScope, nodeType: null }, sumPrice, 'r')
		expect(result.total).toBe(3370)
	})

	it('never counts itself, even when it would otherwise match', () => {
		// Guards the feedback loop that would appear the moment rollups gain `extractFacts`.
		const facts = new Map([...shoppingBoard(), item('rollup1', { price: 10_000 })])
		const result = aggregate(facts, pageScope, sumPrice, 'rollup1')
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
