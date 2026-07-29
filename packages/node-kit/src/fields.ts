import { T } from 'tldraw'

/**
 * The field type system shared by every node that exposes structured data — item nodes today,
 * table/spreadsheet nodes later. Values are JSON scalars only (§7: "JSON-scalar props only"),
 * which is what keeps props validatable, migratable and sync-ready.
 */
export const FIELD_TYPES = ['text', 'number', 'currency', 'select', 'url', 'date', 'checkbox'] as const

export type FieldType = (typeof FIELD_TYPES)[number]

/** A field's value. `null` means "empty" for every type — templates rely on this. */
export type FieldValue = string | number | boolean | null

export interface NodeField {
	key: string
	type: FieldType
	value: FieldValue
	/** ISO-4217-ish code for `currency` ('GEL' → ₾), or a display unit for `number` ('kg'). */
	unit?: string
}

export const fieldValidator: T.Validatable<NodeField> = T.object({
	key: T.string,
	type: T.literalEnum(...FIELD_TYPES),
	value: T.jsonValue.refine((v): FieldValue => {
		if (v === null) return null
		const t = typeof v
		if (t === 'string' || t === 'number' || t === 'boolean') return v as FieldValue
		throw new Error(`Field value must be a JSON scalar, got ${t}`)
	}),
	unit: T.string.optional(),
})

// ---------------------------------------------------------------------------
// Currency
// ---------------------------------------------------------------------------

/**
 * Explicit symbol table rather than `Intl.NumberFormat(currency)`, because the driving use case is
 * a Georgian shopping board and `Intl` renders GEL as "GEL 2,399.00" in most locales — the user
 * wants ₾2,399. Unknown codes fall back to the code itself.
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

export const DEFAULT_CURRENCY = 'GEL'

export function currencySymbol(unit: string | undefined): string {
	if (!unit) return currencySymbol(DEFAULT_CURRENCY)
	return CURRENCY_SYMBOLS[unit.toUpperCase()] ?? unit
}

/** Symbols that sit before the amount with no space; anything else gets "1 234 CODE". */
function symbolIsPrefix(symbol: string): boolean {
	return symbol.length <= 2
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
 * Money formatting differs from plain numbers in one way that matters: a fractional amount shows
 * *both* minor units (₾1,200.50, never ₾1,200.5), while a whole amount shows none at all
 * (₾2,399, not ₾2,399.00) because board totals are read at a glance.
 */
export function formatCurrency(value: number, unit?: string): string {
	if (!Number.isFinite(value)) return '—'
	const symbol = currencySymbol(unit)
	const fractionDigits = Number.isInteger(value) ? 0 : 2
	const amount = new Intl.NumberFormat('en-US', {
		minimumFractionDigits: fractionDigits,
		maximumFractionDigits: fractionDigits,
	}).format(value)
	return symbolIsPrefix(symbol) ? `${symbol}${amount}` : `${amount} ${symbol}`
}

// ---------------------------------------------------------------------------
// Coercion & display
// ---------------------------------------------------------------------------

/**
 * Turn raw editor input into a validated scalar for the given field type. Returns `null` for
 * anything blank or unparseable, so a half-typed field never corrupts props.
 */
export function coerceFieldValue(type: FieldType, raw: unknown): FieldValue {
	if (type === 'checkbox') return raw === true || raw === 'true'
	if (raw === null || raw === undefined) return null
	if (typeof raw === 'string' && raw.trim() === '') return null

	switch (type) {
		case 'number':
		case 'currency': {
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
			return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : (s || null)
		}
		default:
			return String(raw)
	}
}

/** Human-readable rendering of a single field value, used by the item card. */
export function formatFieldValue(field: NodeField): string {
	const { type, value, unit } = field
	if (type === 'checkbox') return value === true ? '✓' : '—'
	if (value === null || value === '') return '—'

	switch (type) {
		case 'currency':
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
 * The numeric projection used by the rollup engine. Only genuinely numeric types contribute to
 * `sum`/`avg`/`min`/`max`; a `text` field holding "12" does not, because silently summing text
 * would make totals depend on typos.
 */
export function numericFieldValue(field: NodeField): number | null {
	if (field.type !== 'number' && field.type !== 'currency') return null
	return typeof field.value === 'number' && Number.isFinite(field.value) ? field.value : null
}

/** Slug used as a field key when the user types a label. Keeps keys comparable across items. */
export function normalizeFieldKey(label: string): string {
	return label
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
}

/** Title-cases a field key for display: `unit_price` → `Unit price`. */
export function fieldKeyLabel(key: string): string {
	const spaced = key.replace(/[_-]+/g, ' ').trim()
	return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function defaultUnitForType(type: FieldType): string | undefined {
	return type === 'currency' ? DEFAULT_CURRENCY : undefined
}
