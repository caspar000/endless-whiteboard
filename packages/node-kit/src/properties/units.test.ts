import { describe, expect, it } from 'vitest'
import { formatPropertyValue } from './format'
import type { PropertyDef } from './types'
import { readShapePropertyUnits, unitForShapeProperty } from './values'

const price: PropertyDef = { id: 'price', name: 'Price', type: 'financial', unit: 'GEL' }

const shape = (meta: Record<string, unknown>) => ({ meta: meta as never })

describe('per-shape units', () => {
	it('falls back to the definition when the shape says nothing', () => {
		const units = readShapePropertyUnits(shape({}))
		expect(unitForShapeProperty(price, units)).toBe('GEL')
	})

	/** The bug this exists for: one shape in USD must not drag every other shape with it. */
	it('lets one shape override without touching the definition', () => {
		const inUsd = readShapePropertyUnits(shape({ 'lifeboard:propUnits': { price: 'USD' } }))
		const plain = readShapePropertyUnits(shape({}))

		expect(unitForShapeProperty(price, inUsd)).toBe('USD')
		expect(unitForShapeProperty(price, plain)).toBe('GEL')
		expect(price.unit).toBe('GEL')
	})

	it('formats each shape in its own currency', () => {
		expect(formatPropertyValue(price, 2399, 'GEL')).toBe('₾ 2,399.00')
		expect(formatPropertyValue(price, 2399, 'USD')).toBe('$ 2,399.00')
		// No override given: the definition's default.
		expect(formatPropertyValue(price, 2399)).toBe('₾ 2,399.00')
	})

	it('ignores malformed entries, because meta is untyped JSON', () => {
		const units = readShapePropertyUnits(
			shape({ 'lifeboard:propUnits': { price: 7, other: '', good: 'EUR' } })
		)
		expect(units).toEqual({ good: 'EUR' })
		// A junk override falls back rather than rendering nothing.
		expect(unitForShapeProperty(price, units)).toBe('GEL')
	})

	it('returns the shared frozen empty when there is nothing to read', () => {
		// Identity matters: `areFactsEqual` tests it first, and almost no shape has an override.
		expect(readShapePropertyUnits(shape({}))).toBe(readShapePropertyUnits(shape({ other: 1 })))
	})
})
