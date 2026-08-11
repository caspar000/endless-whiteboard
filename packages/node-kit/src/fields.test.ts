import { describe, expect, it } from 'vitest'
import {
	coerceFieldValue,
	currencySymbol,
	fieldKeyLabel,
	formatCurrency,
	formatFieldValue,
	formatNumber,
	normalizeFieldKey,
	numericFieldValue,
} from './fields'

describe('currency formatting', () => {
	it('renders GEL as ₾ prefix — the driving use case', () => {
		expect(formatCurrency(2399, 'GEL')).toBe('₾ 2,399.00')
	})

	it('defaults to GEL when no unit is given', () => {
		expect(formatCurrency(10)).toBe('₾ 10.00')
	})

	it('omits decimals for integers and keeps two for fractions', () => {
		expect(formatCurrency(1200, 'USD')).toBe('$ 1,200.00')
		expect(formatCurrency(1200.5, 'USD')).toBe('$ 1,200.50')
		expect(formatCurrency(0.333, 'USD')).toBe('$ 0.33')
	})

	it('uses the code itself for unknown currencies, still symbol-first', () => {
		expect(formatCurrency(500, 'XYZ')).toBe('XYZ 500.00')
	})

	it('is case-insensitive about the code', () => {
		expect(currencySymbol('gel')).toBe('₾')
	})

	it('renders non-finite input as an em dash rather than NaN', () => {
		expect(formatCurrency(Number.NaN, 'GEL')).toBe('—')
		expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('—')
	})
})

describe('coerceFieldValue', () => {
	it('parses prices the way people actually type them', () => {
		expect(coerceFieldValue('currency', '2399')).toBe(2399)
		expect(coerceFieldValue('currency', '₾2,399')).toBe(2399)
		expect(coerceFieldValue('currency', '$1,200.50')).toBe(1200.5)
		expect(coerceFieldValue('number', '42')).toBe(42)
	})

	it('treats a comma as a decimal separator when there is no dot', () => {
		expect(coerceFieldValue('number', '1,5')).toBe(1.5)
	})

	it('returns null for blank or unparseable numeric input', () => {
		expect(coerceFieldValue('currency', '')).toBeNull()
		expect(coerceFieldValue('currency', '   ')).toBeNull()
		expect(coerceFieldValue('number', 'abc')).toBeNull()
		expect(coerceFieldValue('number', null)).toBeNull()
	})

	it('coerces checkboxes to a real boolean, never null', () => {
		expect(coerceFieldValue('checkbox', true)).toBe(true)
		expect(coerceFieldValue('checkbox', 'true')).toBe(true)
		expect(coerceFieldValue('checkbox', null)).toBe(false)
		expect(coerceFieldValue('checkbox', 'nonsense')).toBe(false)
	})

	it('keeps text as text', () => {
		expect(coerceFieldValue('text', 'desk')).toBe('desk')
		expect(coerceFieldValue('select', 'furniture')).toBe('furniture')
	})

	it('rejects non-finite numbers', () => {
		expect(coerceFieldValue('number', Number.NaN)).toBeNull()
		expect(coerceFieldValue('number', Number.POSITIVE_INFINITY)).toBeNull()
	})
})

describe('formatFieldValue', () => {
	it('formats each type for display', () => {
		expect(formatFieldValue({ key: 'price', type: 'currency', value: 2399, unit: 'GEL' })).toBe('₾ 2,399.00')
		expect(formatFieldValue({ key: 'weight', type: 'number', value: 72.5, unit: 'kg' })).toBe('72.5 kg')
		expect(formatFieldValue({ key: 'done', type: 'checkbox', value: true })).toBe('✓')
		expect(formatFieldValue({ key: 'done', type: 'checkbox', value: false })).toBe('—')
		expect(formatFieldValue({ key: 'cat', type: 'text', value: 'desk' })).toBe('desk')
	})

	it('shows an em dash for empty values', () => {
		expect(formatFieldValue({ key: 'price', type: 'currency', value: null })).toBe('—')
		expect(formatFieldValue({ key: 'note', type: 'text', value: '' })).toBe('—')
	})

	it('formats ISO dates readably and passes other strings through', () => {
		expect(formatFieldValue({ key: 'due', type: 'date', value: '2026-07-29' })).toBe('29 Jul 2026')
		expect(formatFieldValue({ key: 'due', type: 'date', value: 'someday' })).toBe('someday')
	})
})

describe('numericFieldValue', () => {
	it('projects only genuinely numeric types', () => {
		expect(numericFieldValue({ key: 'p', type: 'currency', value: 10 })).toBe(10)
		expect(numericFieldValue({ key: 'p', type: 'number', value: 10 })).toBe(10)
	})

	it('does not silently sum text that happens to look numeric', () => {
		// A `text` field holding "12" must not contribute to a sum, or totals would depend on
		// whether someone remembered to set the field type.
		expect(numericFieldValue({ key: 'p', type: 'text', value: '12' })).toBeNull()
	})

	it('returns null for empty numeric fields', () => {
		expect(numericFieldValue({ key: 'p', type: 'currency', value: null })).toBeNull()
	})
})

describe('field keys', () => {
	it('normalizes user labels into stable keys', () => {
		expect(normalizeFieldKey('Unit Price')).toBe('unit_price')
		expect(normalizeFieldKey('  price!! ')).toBe('price')
		expect(normalizeFieldKey('---')).toBe('')
	})

	it('renders keys back as labels', () => {
		expect(fieldKeyLabel('unit_price')).toBe('Unit price')
		expect(fieldKeyLabel('price')).toBe('Price')
	})
})
