import { linkDisplayText, parseLinkValue } from './link'
import {
	DEFAULT_CURRENCY,
	RATING_MAX,
	isListType,
	isNumericType,
	type PropertyDef,
	type PropertyType,
	type PropertyValue,
} from './types'

/**
 * Coercion and display for property values. Moved from the old `fields.ts` largely intact — the
 * currency and number rules here are the product of real use and are covered by their own tests.
 *
 * The one real change is that every function now takes the *definition*, not a value bundled with its
 * type. That fixes a latent bug: field type used to be erased at the facts boundary, so the rollup
 * engine re-derived numeric-ness privately and `numericFieldValue` had no runtime consumer at all.
 * With a registry, type comes from the definition and aggregation can be gated properly.
 */

/**
 * The common symbols, spelled out so the board's own money (GEL) never depends on the runtime's
 * ICU data. Codes not listed here fall through to `Intl`, so any ISO-4217 code — CHF, SEK, KRW —
 * still resolves to whatever symbol the platform knows; only then does the code itself show.
 */
const CURRENCY_SYMBOLS: Record<string, string> = {
	GEL: '₾',
	USD: '$',
	EUR: '€',
	GBP: '£',
	JPY: '¥',
	RUB: '₽',
	TRY: '₺',
	INR: '₹',
	UAH: '₴',
	AMD: '֏',
	AZN: '₼',
}

const intlSymbolCache = new Map<string, string | null>()

function intlCurrencySymbol(code: string): string | null {
	if (intlSymbolCache.has(code)) return intlSymbolCache.get(code)!
	let symbol: string | null = null
	try {
		const parts = new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: code,
			currencyDisplay: 'narrowSymbol',
		}).formatToParts(1)
		symbol = parts.find((part) => part.type === 'currency')?.value ?? null
	} catch {
		// Not a currency code Intl knows. The caller falls back to showing the code itself.
	}
	intlSymbolCache.set(code, symbol)
	return symbol
}

export function currencySymbol(unit: string | undefined): string {
	if (!unit) return currencySymbol(DEFAULT_CURRENCY)
	const code = unit.trim().toUpperCase()
	return CURRENCY_SYMBOLS[code] ?? intlCurrencySymbol(code) ?? unit
}

/**
 * Plain-number formatting: grouped, with however many decimals the value actually has (up to 2).
 * `72.5` stays `72.5` — padding a weight to `72.50` would read as false precision.
 */
export function formatNumber(value: number, maxFractionDigits = 2): string {
	if (!Number.isFinite(value)) return '—'
	return new Intl.NumberFormat('en-US', {
		minimumFractionDigits: 0,
		maximumFractionDigits: maxFractionDigits,
	}).format(value)
}

/**
 * Money formatting, fixed shape by design: `{symbol} {amount}` — symbol first, one space, comma
 * thousands separator, dot decimal point, always exactly two decimals (`₾ 2,399.00`, `$ -1,200.50`).
 * The uniform two decimals is what lets a column of money line up on the decimal point.
 */
export function formatCurrency(value: number, unit?: string): string {
	if (!Number.isFinite(value)) return '—'
	const symbol = currencySymbol(unit)
	const amount = new Intl.NumberFormat('en-US', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(value)
	return `${symbol} ${amount}`
}

/**
 * Turn raw editor input into a validated value for the given type. Returns the type's empty value for
 * anything blank or unparseable, so a half-typed property never corrupts a shape's meta.
 */
export function coercePropertyValue(type: PropertyType, raw: unknown): PropertyValue {
	if (type === 'checkbox') return raw === true || raw === 'true'

	if (isListType(type)) {
		// Accepts both what the editor holds (an array) and what a person types (comma-separated),
		// deduped and trimmed, because a multiSelect with "  desk" and "desk" as separate values is
		// never what anyone means.
		const parts = Array.isArray(raw)
			? raw.map((v) => String(v))
			: raw === null || raw === undefined
				? []
				: String(raw).split(',')
		const seen = new Set<string>()
		for (const part of parts) {
			const trimmed = part.trim()
			if (trimmed) seen.add(trimmed)
		}
		return [...seen]
	}

	if (raw === null || raw === undefined) return null
	if (typeof raw === 'string' && raw.trim() === '') return null

	switch (type) {
		// Bounded whole numbers. Clamped rather than rejected, because the controls that produce them
		// (five stars, a slider) can only ever be out of range if a value arrives from somewhere else —
		// an import, a paste, a hand-edited backup — and a clamped 5 is better than a dropped value.
		case 'rating':
		case 'progress': {
			const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw).replace(/[^\d.\-]/g, ''))
			if (!Number.isFinite(n)) return null
			const max = type === 'rating' ? RATING_MAX : 100
			const clamped = Math.min(max, Math.max(0, Math.round(n)))
			// Zero means "not rated" for stars, which is the only way to clear one by clicking.
			return type === 'rating' && clamped === 0 ? null : clamped
		}
		case 'number':
		case 'financial': {
			if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
			// Tolerate the way people actually type prices: "₾2,399", "2 399.50", "$1,200"
			const cleaned = String(raw).replace(/[^\d.,\-]/g, '')
			const normalized =
				cleaned.includes(',') && cleaned.includes('.')
					? cleaned.replace(/,/g, '') // 1,234.56 → 1234.56
					: cleaned.replace(/,(\d{3})(?!\d)/g, '$1').replace(/,/g, '.') // 1,5 → 1.5
			const n = Number.parseFloat(normalized)
			return Number.isFinite(n) ? n : null
		}
		case 'date': {
			const s = String(raw).trim()
			return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : s || null
		}
		default:
			return String(raw)
	}
}

/**
 * The calendar day a value falls on, as `YYYY-MM-DD`, or `null` for anything that is not a date.
 *
 * A `date` property already stores exactly this (see `parsePropertyInput`), so the fast path is a
 * ten-character slice. The fallback is for values that arrived some other way — an import, an agent, a
 * property retyped from text — and it deliberately reads them in **local** time: a board that showed a
 * task on the 13th because the browser is east of UTC would be wrong about the only thing a calendar is
 * for.
 */
export function isoDayValue(value: PropertyValue | undefined): string | null {
	if (typeof value !== 'string' || !value) return null
	if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
	const parsed = new Date(value)
	if (Number.isNaN(parsed.getTime())) return null
	const month = String(parsed.getMonth() + 1).padStart(2, '0')
	const day = String(parsed.getDate()).padStart(2, '0')
	return `${parsed.getFullYear()}-${month}-${day}`
}

/**
 * Human-readable rendering of one property's value.
 *
 * `unit` overrides the definition's, because a unit is per *shape*: two cards can carry the same price
 * property in different currencies. Callers that have a shape resolve it with `unitForShapeProperty`;
 * omitting it falls back to the definition's default, which is right for a value with no shape behind
 * it (a summary row, say).
 */
export function formatPropertyValue(
	def: PropertyDef,
	value: PropertyValue,
	unit = def.unit
): string {
	if (def.type === 'checkbox') return value === true ? '✓' : '—'
	if (isListType(def.type)) {
		return Array.isArray(value) && value.length ? value.join(', ') : '—'
	}
	if (value === null || value === undefined || value === '') return '—'

	switch (def.type) {
		// The title, not the stored `[title](url)` — that encoding is storage, never something to read.
		case 'link':
			return linkDisplayText(value)
		// Stars as text, so a table cell and a card agree and neither needs a special renderer to be
		// readable. Filled and empty both drawn, because "★★★" alone doesn't say out of how many.
		case 'rating': {
			if (typeof value !== 'number') return String(value)
			const filled = Math.min(RATING_MAX, Math.max(0, Math.round(value)))
			return '★'.repeat(filled) + '☆'.repeat(RATING_MAX - filled)
		}
		case 'progress':
			return typeof value === 'number' ? `${Math.round(value)}%` : String(value)
		case 'financial':
			return typeof value === 'number' ? formatCurrency(value, unit) : String(value)
		case 'number': {
			if (typeof value !== 'number') return String(value)
			return unit ? `${formatNumber(value)} ${unit}` : formatNumber(value)
		}
		case 'date': {
			const d = new Date(String(value))
			return Number.isNaN(d.getTime())
				? String(value)
				: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
		}
		default:
			return String(value)
	}
}

/**
 * The numeric projection used by aggregation. Only genuinely numeric *types* contribute to
 * sum/avg/min/max; a `text` property holding "12" does not, because silently summing text would make
 * totals depend on typos.
 */
export function numericPropertyValue(def: PropertyDef, value: PropertyValue): number | null {
	if (!isNumericType(def.type)) return null
	return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * The bucket keys a value contributes when it is used to *group* rows.
 *
 * A list value contributes each of its entries, so grouping by a multiSelect can put a shape in every
 * bucket it is tagged with — which is what made tags foldable into properties in the first place.
 *
 * Deliberately the **raw** value, not its display form. A bucket key is an identity, and formatting
 * corrupts identities: a `number` property holding a year would group under `2,026`, and two dates a
 * day apart could round to the same label. The one cost is a plainer label for money — `1200` rather
 * than `₾1,200` — which is the right trade for buckets that always mean what they say.
 */
export function groupKeysForValue(def: PropertyDef, value: PropertyValue): string[] {
	if (isListType(def.type)) {
		return Array.isArray(value) ? value.filter((v) => v !== '') : []
	}
	if (value === null || value === undefined || value === '') return []
	// A link groups by its *address*, not by the stored `[title](url)` string: two rows pointing at the
	// same page belong in one bucket whatever they happen to be called, and a raw encoded value would
	// make an unreadable bucket label. The URL is the identity here, exactly as the raw value is for
	// every other type.
	if (def.type === 'link') {
		const url = parseLinkValue(value).url
		return url ? [url] : []
	}
	return [String(value)]
}
