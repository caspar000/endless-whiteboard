import { describe, expect, it } from 'vitest'
import {
	convertAmount,
	currenciesUsed,
	mergeRates,
	normaliseCurrency,
	rateBetween,
	type RateTable,
} from './rates'

// One USD buys 2.62 GEL and 0.87 EUR.
const table: RateTable = {
	base: 'USD',
	rates: { GEL: 2.62, EUR: 0.87, USD: 1 },
	asOf: 1_754_000_000_000,
	stale: false,
}

describe('rateBetween', () => {
	it('is 1 when there is nothing to convert', () => {
		expect(rateBetween(table, 'USD', 'USD')).toBe(1)
		// No currency on either side is a plain number, not a failure.
		expect(rateBetween(table, undefined, undefined)).toBe(1)
		expect(rateBetween(null, 'USD', 'USD')).toBe(1)
	})

	it('crosses two currencies through the base', () => {
		expect(rateBetween(table, 'USD', 'GEL')).toBeCloseTo(2.62, 10)
		expect(rateBetween(table, 'GEL', 'USD')).toBeCloseTo(1 / 2.62, 10)
		// EUR → GEL touches the base twice and never appears in the table directly.
		expect(rateBetween(table, 'EUR', 'GEL')).toBeCloseTo(2.62 / 0.87, 10)
	})

	/**
	 * The whole reason this returns `null` rather than 1: treating an unknown currency as
	 * one-to-one is exactly how a total comes out confident and wrong.
	 */
	it('refuses rather than guessing when a currency is unknown', () => {
		expect(rateBetween(table, 'XYZ', 'USD')).toBeNull()
		expect(rateBetween(table, 'USD', 'XYZ')).toBeNull()
		expect(rateBetween(null, 'USD', 'GEL')).toBeNull()
	})

	it('is case- and whitespace-insensitive, because the input box is a text field', () => {
		expect(rateBetween(table, ' gel ', 'usd')).toBeCloseTo(1 / 2.62, 10)
		expect(normaliseCurrency('  eur ')).toBe('EUR')
		expect(normaliseCurrency('   ')).toBeUndefined()
	})
})

describe('convertAmount', () => {
	it('converts at full precision, leaving rounding to the display', () => {
		expect(convertAmount(100, 'USD', 'GEL', table)).toBeCloseTo(262, 10)
		// Deliberately not pre-rounded: summing rounded terms makes a long column drift.
		expect(convertAmount(10, 'GEL', 'USD', table)).toBeCloseTo(10 / 2.62, 10)
	})

	it('passes an amount through untouched when the currencies match', () => {
		expect(convertAmount(42, 'GEL', 'GEL', table)).toBe(42)
	})

	it('is null when the conversion cannot be made', () => {
		expect(convertAmount(100, 'XYZ', 'GEL', table)).toBeNull()
		expect(convertAmount(Number.NaN, 'USD', 'GEL', table)).toBeNull()
	})
})

describe('mergeRates', () => {
	it('lets a hand-entered rate beat the fetched one', () => {
		// The rate someone actually got, not today's mid-market figure.
		const merged = mergeRates(table, { GEL: 3 })
		expect(rateBetween(merged, 'USD', 'GEL')).toBeCloseTo(3, 10)
		// Everything else still comes from the fetched table.
		expect(rateBetween(merged, 'USD', 'EUR')).toBeCloseTo(0.87, 10)
	})

	it('works with no fetched table at all, which is the offline case', () => {
		const merged = mergeRates(null, { GEL: 2.5 })
		expect(rateBetween(merged, 'USD', 'GEL')).toBeCloseTo(2.5, 10)
	})

	it('ignores junk instead of poisoning the table', () => {
		const merged = mergeRates(table, { GEL: 0, EUR: Number.NaN, AAA: -1 })
		expect(rateBetween(merged, 'USD', 'GEL')).toBeCloseTo(2.62, 10)
		expect(rateBetween(merged, 'USD', 'AAA')).toBeNull()
	})

	it('returns the table untouched when there is nothing manual', () => {
		expect(mergeRates(table, {})).toBe(table)
		expect(mergeRates(table, undefined)).toBe(table)
	})
})

describe('currenciesUsed', () => {
	it('lists the distinct currencies, normalised, ignoring blanks', () => {
		expect(currenciesUsed(['USD', 'gel', undefined, 'USD', '  '])).toEqual(['USD', 'GEL'])
	})
})
