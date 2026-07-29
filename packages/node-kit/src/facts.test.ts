import { describe, expect, it } from 'vitest'
import {
	areFactsEqual,
	areFactsMapsEqual,
	collectFieldKeys,
	collectTags,
	dominantUnit,
	type FactsMap,
	type NodeFacts,
} from './facts'

function facts(over: Partial<NodeFacts> = {}): NodeFacts {
	return {
		type: 'node.item',
		parentId: null,
		tags: ['furniture'],
		fields: { price: 2399, category: 'desk' },
		units: { price: 'GEL' },
		label: 'Desk',
		...over,
	}
}

describe('areFactsEqual', () => {
	it('treats structurally identical facts as equal', () => {
		expect(areFactsEqual(facts(), facts())).toBe(true)
	})

	it('detects a changed field value', () => {
		expect(areFactsEqual(facts(), facts({ fields: { price: 2400, category: 'desk' } }))).toBe(false)
	})

	it('detects an added or removed field', () => {
		expect(areFactsEqual(facts(), facts({ fields: { price: 2399 } }))).toBe(false)
	})

	it('detects a changed tag list, parent, unit or label', () => {
		expect(areFactsEqual(facts(), facts({ tags: ['decor'] }))).toBe(false)
		expect(areFactsEqual(facts(), facts({ tags: [] }))).toBe(false)
		expect(areFactsEqual(facts(), facts({ parentId: 'shape:frame1' }))).toBe(false)
		expect(areFactsEqual(facts(), facts({ units: { price: 'USD' } }))).toBe(false)
		expect(areFactsEqual(facts(), facts({ label: 'Chair' }))).toBe(false)
	})

	it('distinguishes null from a missing field key', () => {
		expect(areFactsEqual(facts({ fields: { price: null } }), facts({ fields: {} }))).toBe(false)
	})
})

describe('areFactsMapsEqual — the drag tripwire', () => {
	it('is true for maps whose facts are equal but freshly rebuilt', () => {
		// This is the exact situation during a drag: the computed re-runs and builds a brand-new
		// Map with brand-new NodeFacts objects, but no data changed. It must compare equal, or
		// every rollup on the board re-aggregates on every pointer move.
		const a: FactsMap = new Map([['shape:1', facts()], ['shape:2', facts({ label: 'Chair' })]])
		const b: FactsMap = new Map([['shape:1', facts()], ['shape:2', facts({ label: 'Chair' })]])
		expect(a).not.toBe(b)
		expect(areFactsMapsEqual(a, b)).toBe(true)
	})

	it('is false when a node is added or removed', () => {
		const a: FactsMap = new Map([['shape:1', facts()]])
		const b: FactsMap = new Map([['shape:1', facts()], ['shape:2', facts()]])
		expect(areFactsMapsEqual(a, b)).toBe(false)
	})

	it('is false when a node id changes but the size does not', () => {
		const a: FactsMap = new Map([['shape:1', facts()]])
		const b: FactsMap = new Map([['shape:2', facts()]])
		expect(areFactsMapsEqual(a, b)).toBe(false)
	})

	it('is false when one node’s data changes', () => {
		const a: FactsMap = new Map([['shape:1', facts()]])
		const b: FactsMap = new Map([['shape:1', facts({ fields: { price: 1 } })]])
		expect(areFactsMapsEqual(a, b)).toBe(false)
	})
})

describe('picker helpers', () => {
	const board: FactsMap = new Map([
		['a', facts({ fields: { price: 1, category: 'desk' }, tags: ['furniture'] })],
		['b', facts({ fields: { price: 2, brand: 'ikea' }, tags: ['decor', 'furniture'] })],
		['c', { ...facts({ fields: { weight: 3 } }), type: 'other.node' }],
	])

	it('collects sorted field keys, optionally filtered by node type', () => {
		expect(collectFieldKeys(board, 'node.item')).toEqual(['brand', 'category', 'price'])
		expect(collectFieldKeys(board)).toEqual(['brand', 'category', 'price', 'weight'])
	})

	it('collects sorted unique tags', () => {
		expect(collectTags(board)).toEqual(['decor', 'furniture'])
	})

	it('picks the most common unit for a field key', () => {
		const mixed: FactsMap = new Map([
			['a', facts({ units: { price: 'GEL' } })],
			['b', facts({ units: { price: 'GEL' } })],
			['c', facts({ units: { price: 'USD' } })],
		])
		expect(dominantUnit(mixed, 'price')).toBe('GEL')
		expect(dominantUnit(mixed, 'nonexistent')).toBeUndefined()
	})
})
