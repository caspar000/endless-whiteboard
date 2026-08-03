import { describe, expect, it } from 'vitest'
import {
	coercePropertyValue,
	formatPropertyValue,
	groupKeysForValue,
	numericPropertyValue,
} from './format'
import { emptyValueForType, propertyIdFromName, type PropertyDef } from './types'

const def = (over: Partial<PropertyDef> = {}): PropertyDef => ({
	id: 'p',
	name: 'P',
	type: 'text',
	...over,
})

/**
 * Currency and number formatting are covered by `fields.test.ts`, which still runs against these
 * functions through the legacy adapter — deliberately, so that the move out of `fields.ts` is proven
 * behaviour-preserving rather than merely believed to be. What follows tests only what is new:
 * list-valued properties, and type coming from a definition instead of from the value.
 */
describe('multiSelect coercion', () => {
	const multi = 'multiSelect' as const

	it('accepts an array as-is, trimmed', () => {
		expect(coercePropertyValue(multi, [' desk ', 'lamp'])).toEqual(['desk', 'lamp'])
	})

	it('accepts what a person types: comma-separated', () => {
		expect(coercePropertyValue(multi, 'furniture, decor')).toEqual(['furniture', 'decor'])
	})

	it('dedupes, since "desk" twice is never what anyone means', () => {
		expect(coercePropertyValue(multi, ['desk', ' desk', 'lamp'])).toEqual(['desk', 'lamp'])
	})

	it('drops empties rather than storing blank tags', () => {
		expect(coercePropertyValue(multi, 'a,,  ,b')).toEqual(['a', 'b'])
		expect(coercePropertyValue(multi, '')).toEqual([])
		expect(coercePropertyValue(multi, null)).toEqual([])
	})
})

describe('formatPropertyValue', () => {
	it('joins list values and shows a dash for an empty one', () => {
		const tags = def({ type: 'multiSelect' })
		expect(formatPropertyValue(tags, ['furniture', 'decor'])).toBe('furniture, decor')
		expect(formatPropertyValue(tags, [])).toBe('—')
	})

	it('takes unit from the definition, not from the value', () => {
		// The point of the registry: a value is just a number, and its meaning lives in one place.
		expect(formatPropertyValue(def({ type: 'currency', unit: 'GEL' }), 2399)).toBe('₾2,399')
		expect(formatPropertyValue(def({ type: 'number', unit: 'kg' }), 72.5)).toBe('72.5 kg')
	})
})

describe('numericPropertyValue', () => {
	it('projects number and currency', () => {
		expect(numericPropertyValue(def({ type: 'number' }), 5)).toBe(5)
		expect(numericPropertyValue(def({ type: 'currency' }), 2399)).toBe(2399)
	})

	it('refuses a numeric-looking text value, so a typo cannot change a total', () => {
		expect(numericPropertyValue(def({ type: 'text' }), '12')).toBeNull()
		expect(numericPropertyValue(def({ type: 'select' }), '12')).toBeNull()
	})

	it('refuses a non-finite or non-number value on a numeric property', () => {
		expect(numericPropertyValue(def({ type: 'number' }), Number.NaN)).toBeNull()
		expect(numericPropertyValue(def({ type: 'number' }), 'twelve')).toBeNull()
		expect(numericPropertyValue(def({ type: 'number' }), null)).toBeNull()
	})
})

describe('groupKeysForValue', () => {
	it('puts a list-valued shape in every bucket it carries', () => {
		// This is what folding tags into properties bought: grouping by a multiSelect works without
		// tags being a separate concept.
		expect(groupKeysForValue(def({ type: 'multiSelect' }), ['furniture', 'decor'])).toEqual([
			'furniture',
			'decor',
		])
	})

	it('groups a scalar by its raw value, because a bucket key is an identity', () => {
		// Not the display form: formatting a `number` would group a year under "2,026", and two nearby
		// dates could round to one label. A plainer money label is the price of buckets that don't lie.
		expect(groupKeysForValue(def({ type: 'currency', unit: 'USD' }), 1200)).toEqual(['1200'])
		expect(groupKeysForValue(def({ type: 'number' }), 2026)).toEqual(['2026'])
		expect(groupKeysForValue(def({ type: 'date' }), '2026-08-03')).toEqual(['2026-08-03'])
	})

	it('contributes no bucket for an empty value', () => {
		expect(groupKeysForValue(def({ type: 'multiSelect' }), [])).toEqual([])
		expect(groupKeysForValue(def({ type: 'text' }), null)).toEqual([])
		expect(groupKeysForValue(def({ type: 'text' }), '')).toEqual([])
	})
})

describe('propertyIdFromName', () => {
	it('is a deterministic slug, which is what makes the item migration idempotent', () => {
		expect(propertyIdFromName('Unit Price')).toBe('unit_price')
		expect(propertyIdFromName('  price!! ')).toBe('price')
		expect(propertyIdFromName('Unit Price')).toBe(propertyIdFromName('unit price'))
	})

	it('strips leading underscores, which are reserved for built-in table columns', () => {
		expect(propertyIdFromName('__label')).toBe('label')
	})

	it('returns empty for a name with nothing usable in it, rather than inventing one', () => {
		expect(propertyIdFromName('---')).toBe('')
		expect(propertyIdFromName('   ')).toBe('')
	})
})

describe('emptyValueForType', () => {
	it('is the value a freshly attached property holds', () => {
		expect(emptyValueForType('checkbox')).toBe(false)
		expect(emptyValueForType('multiSelect')).toEqual([])
		expect(emptyValueForType('text')).toBeNull()
		expect(emptyValueForType('currency')).toBeNull()
	})
})
