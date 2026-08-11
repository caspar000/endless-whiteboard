import { describe, expect, it } from 'vitest'
import {
	areFactsEqual,
	areFactsMapsEqual,
	areValueRecordsEqual,
	collectPropertyIds,
	collectValuesForProperty,
	isEmptyValue,
	listValuesOf,
	type FactsMap,
	type ShapeFacts,
} from './facts'
import type { PropertyDef } from './properties/types'

function facts(over: Partial<ShapeFacts> = {}): ShapeFacts {
	return {
		type: 'node.markdown',
		parentId: null,
		label: 'Desk',
		values: { price: 2399, category: 'desk', tags: ['furniture'] },
		units: {},
		...over,
	}
}

describe('areFactsEqual', () => {
	it('treats structurally identical facts as equal', () => {
		expect(areFactsEqual(facts(), facts())).toBe(true)
	})

	it('detects a changed value', () => {
		expect(areFactsEqual(facts(), facts({ values: { ...facts().values, price: 2400 } }))).toBe(
			false
		)
	})

	it('detects an added or removed property', () => {
		expect(areFactsEqual(facts(), facts({ values: { price: 2399 } }))).toBe(false)
	})

	it('detects a changed type, parent or label', () => {
		expect(areFactsEqual(facts(), facts({ type: 'geo' }))).toBe(false)
		expect(areFactsEqual(facts(), facts({ parentId: 'shape:frame1' }))).toBe(false)
		expect(areFactsEqual(facts(), facts({ label: 'Chair' }))).toBe(false)
	})

	it('distinguishes null from a missing property', () => {
		expect(areFactsEqual(facts({ values: { price: null } }), facts({ values: {} }))).toBe(false)
	})
})

describe('areValueRecordsEqual', () => {
	it('compares list values element-wise, since every read builds a fresh array', () => {
		// Reference equality can never fire for a list value, so without this a board with any tagged
		// shape would re-aggregate on every pointer move — the exact regression the drag guarantee is
		// about.
		expect(areValueRecordsEqual({ tags: ['a', 'b'] }, { tags: ['a', 'b'] })).toBe(true)
		expect(areValueRecordsEqual({ tags: ['a', 'b'] }, { tags: ['b', 'a'] })).toBe(false)
		expect(areValueRecordsEqual({ tags: ['a'] }, { tags: ['a', 'b'] })).toBe(false)
		expect(areValueRecordsEqual({ tags: [] }, { tags: [] })).toBe(true)
	})

	it('does not confuse a list with a scalar', () => {
		expect(areValueRecordsEqual({ x: ['a'] }, { x: 'a' })).toBe(false)
	})

	it('is one level deep, which is why values are bounded to scalars and string lists', () => {
		const shared = ['a']
		expect(areValueRecordsEqual({ x: shared }, { x: shared })).toBe(true)
	})
})

describe('areFactsMapsEqual — the drag tripwire', () => {
	it('is true for maps whose facts are equal but freshly rebuilt', () => {
		// The exact situation during a drag: the computed re-runs and builds a brand-new Map with
		// brand-new facts objects, but no data changed. It must compare equal, or every rollup on the
		// board re-aggregates on every pointer move.
		const a: FactsMap = new Map([
			['shape:1', facts()],
			['shape:2', facts({ label: 'Chair' })],
		])
		const b: FactsMap = new Map([
			['shape:1', facts()],
			['shape:2', facts({ label: 'Chair' })],
		])
		expect(a).not.toBe(b)
		expect(areFactsMapsEqual(a, b)).toBe(true)
	})

	it('is false when a shape is added or removed', () => {
		const a: FactsMap = new Map([['shape:1', facts()]])
		const b: FactsMap = new Map([
			['shape:1', facts()],
			['shape:2', facts()],
		])
		expect(areFactsMapsEqual(a, b)).toBe(false)
	})

	it('is false when a shape id changes but the size does not', () => {
		const a: FactsMap = new Map([['shape:1', facts()]])
		const b: FactsMap = new Map([['shape:2', facts()]])
		expect(areFactsMapsEqual(a, b)).toBe(false)
	})

	it('is false when one shape’s data changes', () => {
		const a: FactsMap = new Map([['shape:1', facts()]])
		const b: FactsMap = new Map([['shape:1', facts({ values: { price: 1 } })]])
		expect(areFactsMapsEqual(a, b)).toBe(false)
	})
})

describe('picker helpers', () => {
	const board: FactsMap = new Map([
		['a', facts({ values: { price: 1, category: 'desk', tags: ['furniture'] } })],
		['b', facts({ values: { price: 2, brand: 'ikea', tags: ['decor', 'furniture'] } })],
		['c', facts({ type: 'geo', values: { weight: 3 } })],
	])

	it('collects sorted property ids, optionally filtered by shape type', () => {
		expect(collectPropertyIds(board, 'node.markdown')).toEqual([
			'brand',
			'category',
			'price',
			'tags',
		])
		expect(collectPropertyIds(board)).toEqual(['brand', 'category', 'price', 'tags', 'weight'])
	})

	it('collects the distinct values present for one property', () => {
		// Read from facts rather than from the registry's `options`, because a value may legitimately
		// exist outside the recorded options.
		expect(collectValuesForProperty(board, 'tags')).toEqual(['decor', 'furniture'])
		expect(collectValuesForProperty(board, 'category')).toEqual(['desk'])
		expect(collectValuesForProperty(board, 'nothing')).toEqual([])
	})
})

describe('listValuesOf', () => {
	const defs = new Map<string, PropertyDef>([
		['tags', { id: 'tags', name: 'Tags', type: 'multiSelect' }],
		['category', { id: 'category', name: 'Category', type: 'select' }],
	])

	it('reads every value of every list-typed property', () => {
		// "The tags of a shape" is derived from the registry's types now, because tags were folded into
		// properties and have no dedicated storage to read.
		expect(listValuesOf({ tags: ['a', 'b'], category: 'desk', price: 1 }, defs)).toEqual(['a', 'b'])
	})

	it('ignores a list value on a property the registry says is not a list', () => {
		const scalarOnly = new Map<string, PropertyDef>([
			['tags', { id: 'tags', name: 'Tags', type: 'text' }],
		])
		expect(listValuesOf({ tags: ['a'] }, scalarOnly)).toEqual([])
	})

	it('trusts an array value when the registry has no definition, so orphans still work', () => {
		expect(listValuesOf({ tags: ['a'] }, new Map())).toEqual(['a'])
	})
})

describe('isEmptyValue', () => {
	it('is true for the ways a property can be empty', () => {
		expect(isEmptyValue(undefined)).toBe(true)
		expect(isEmptyValue(null)).toBe(true)
		expect(isEmptyValue('')).toBe(true)
		expect(isEmptyValue([])).toBe(true)
	})

	it('is false for a value, including zero and false', () => {
		// Zero is a real price and `false` is a real checkbox state — treating either as empty would
		// silently drop rows from an aggregation.
		expect(isEmptyValue(0)).toBe(false)
		expect(isEmptyValue(false)).toBe(false)
		expect(isEmptyValue(['a'])).toBe(false)
	})
})
