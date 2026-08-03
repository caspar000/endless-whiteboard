import { describe, expect, it } from 'vitest'
import { fakeEditor, makeShape } from './fakeEditor'
import { createProperty } from './schema'
import {
	attachProperty,
	readShapeProperties,
	readShapePropertyDefs,
	removeShapeProperty,
	shapeCarriesProperty,
	updateShapeProperties,
} from './values'

function withPrice() {
	const f = fakeEditor()
	createProperty(f.editor, { name: 'Price', type: 'currency', unit: 'GEL' })
	createProperty(f.editor, { name: 'Tags', type: 'multiSelect' })
	return f
}

describe('readShapeProperties', () => {
	it('reads a flat id → value map', () => {
		const shape = makeShape('shape:x', {
			'lifeboard:props': { price: 2399, tags: ['desk', 'work'], done: true, note: null },
		})
		expect(readShapeProperties(shape)).toEqual({
			price: 2399,
			tags: ['desk', 'work'],
			done: true,
			note: null,
		})
	})

	it('returns the same frozen empty object for a shape with no properties', () => {
		// Reference equality is the fast path in `areFactsEqual`, and most shapes on a board carry no
		// properties at all — so this identity is a performance guarantee, not an implementation detail.
		const a = readShapeProperties(makeShape('shape:a'))
		const b = readShapeProperties(makeShape('shape:b', { 'lifeboard:props': {} }))
		expect(a).toBe(b)
		expect(Object.isFrozen(a)).toBe(true)
	})

	it('drops values that are not scalars or string lists', () => {
		const shape = makeShape('shape:x', {
			'lifeboard:props': {
				ok: 1,
				nested: { a: 1 },
				mixedList: ['a', 2],
				okList: ['a'],
			},
		})
		expect(readShapeProperties(shape)).toEqual({ ok: 1, okList: ['a'] })
	})

	it('survives meta written by an older version, or none at all', () => {
		expect(readShapeProperties(makeShape('shape:x', { 'lifeboard:props': 'nope' }))).toEqual({})
		expect(readShapeProperties(makeShape('shape:x', { 'lifeboard:props': [1, 2] }))).toEqual({})
		expect(readShapeProperties(makeShape('shape:x'))).toEqual({})
	})
})

describe('updateShapeProperties', () => {
	it('merges into existing values rather than replacing the map', () => {
		const f = withPrice()
		updateShapeProperties(f.editor, f.shape(), { price: 100 })
		updateShapeProperties(f.editor, f.shape(), { tags: ['desk'] })
		expect(readShapeProperties(f.shape())).toEqual({ price: 100, tags: ['desk'] })
	})

	it('treats undefined as remove and null as attached-but-empty', () => {
		// Genuinely different states: attached-but-empty is what "add Price, fill it in later" produces,
		// and aggregation counts it as *skipped* rather than *not matched*.
		const f = withPrice()
		updateShapeProperties(f.editor, f.shape(), { price: 100, tags: ['desk'] })
		updateShapeProperties(f.editor, f.shape(), { price: null, tags: undefined })
		expect(readShapeProperties(f.shape())).toEqual({ price: null })
		expect(shapeCarriesProperty(f.shape(), 'price')).toBe(true)
		expect(shapeCarriesProperty(f.shape(), 'tags')).toBe(false)
	})

	it('writes in one editor.run, so one edit is one undo entry', () => {
		const f = withPrice()
		const before = f.runs
		updateShapeProperties(f.editor, f.shape(), { price: 1, tags: ['a'] })
		expect(f.runs).toBe(before + 1)
	})

	it('leaves unrelated meta keys alone', () => {
		// The reason the keys are flat and colon-namespaced: tldraw merges `meta` exactly one level
		// deep, so a nested `meta.lifeboard` would be wholly replaced on every write. This fails if
		// anybody nests them.
		const f = fakeEditor({ shapes: { 'shape:a': makeShape('shape:a', { 'other:thing': 42 }) } })
		createProperty(f.editor, { name: 'Price', type: 'number' })
		updateShapeProperties(f.editor, f.shape(), { price: 1 })
		expect(f.shape().meta['other:thing']).toBe(42)
	})
})

describe('the definition sidecar', () => {
	it('travels with the shape for every property it carries', () => {
		const f = withPrice()
		updateShapeProperties(f.editor, f.shape(), { price: 2399, tags: ['desk'] })
		expect(readShapePropertyDefs(f.shape())).toEqual([
			{ id: 'price', name: 'Price', type: 'currency', unit: 'GEL' },
			{ id: 'tags', name: 'Tags', type: 'multiSelect' },
		])
	})

	it('is rebuilt on every write, so a removed property leaves no stale definition', () => {
		const f = withPrice()
		updateShapeProperties(f.editor, f.shape(), { price: 1, tags: ['a'] })
		removeShapeProperty(f.editor, f.shape(), 'tags')
		expect(readShapePropertyDefs(f.shape()).map((d) => d.id)).toEqual(['price'])
	})

	it('omits ids the board has no definition for', () => {
		// Orphaned values are kept (deleting a property does not sweep shapes) but there is nothing
		// truthful to put in the sidecar for them.
		const f = fakeEditor()
		updateShapeProperties(f.editor, f.shape(), { ghost: 1 })
		expect(readShapeProperties(f.shape())).toEqual({ ghost: 1 })
		expect(readShapePropertyDefs(f.shape())).toEqual([])
	})
})

describe('attachProperty', () => {
	it('adds the property with its empty value', () => {
		const f = withPrice()
		attachProperty(f.editor, f.shape(), { id: 'price', name: 'Price', type: 'currency' }, null)
		expect(readShapeProperties(f.shape())).toEqual({ price: null })
	})

	it('does not clobber a value the shape already carries', () => {
		const f = withPrice()
		updateShapeProperties(f.editor, f.shape(), { price: 2399 })
		const before = f.runs
		attachProperty(f.editor, f.shape(), { id: 'price', name: 'Price', type: 'currency' }, null)
		expect(readShapeProperties(f.shape())).toEqual({ price: 2399 })
		expect(f.runs).toBe(before)
	})
})
