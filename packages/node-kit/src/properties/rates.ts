/**
 * Currency conversion — the arithmetic half, with no idea where rates come from.
 *
 * Pure and dependency-free on purpose: fetching and caching are the app's job (they touch the network
 * and storage, which node-kit is not allowed to), while *what a converted total means* belongs with the
 * property system that produces the numbers. That split is also what makes this testable without a
 * network or a fake clock.
 *
 * The rule the rest of the system depends on: a conversion is **display and aggregation only**. The
 * stored value stays exactly what was typed, in the currency it was typed in. Writing a converted
 * amount back would let a rate change silently rewrite someone's data.
 */

/** A set of rates expressed against one base — `rates[code]` is how many `code` one `base` buys. */
export interface RateTable {
	base: string
	rates: Readonly<Record<string, number>>
	/** When the provider last recalculated these, as epoch ms. Shown, so a total can admit its age. */
	asOf: number
	/** True when we are knowingly using rates past their refresh time — offline, usually. */
	stale: boolean
}

/** Rates a person typed in, which beat anything fetched. See `mergeRates`. */
export type ManualRates = Readonly<Record<string, number>>

export function normaliseCurrency(code: string | undefined): string | undefined {
	const trimmed = code?.trim().toUpperCase()
	return trimmed || undefined
}

/**
 * The rate to multiply a `from` amount by to express it in `to`.
 *
 * `null` rather than 1 when a currency is unknown: silently treating an unconvertible value as
 * one-to-one is the failure that produces a confident, wrong total. Callers surface it instead.
 */
export function rateBetween(
	table: RateTable | null,
	from: string | undefined,
	to: string | undefined
): number | null {
	const source = normaliseCurrency(from)
	const target = normaliseCurrency(to)
	// No currency on either side means there is nothing to convert — a plain number, not an error.
	if (!source || !target || source === target) return 1
	if (!table) return null

	const base = normaliseCurrency(table.base)
	// `rates` is relative to the table's base, so a cross-rate is two hops through it.
	const perBaseFrom = source === base ? 1 : table.rates[source]
	const perBaseTo = target === base ? 1 : table.rates[target]
	if (!perBaseFrom || !perBaseTo || !Number.isFinite(perBaseFrom) || !Number.isFinite(perBaseTo)) {
		return null
	}
	return perBaseTo / perBaseFrom
}

/**
 * Converts one amount, or `null` when it cannot be done.
 *
 * Full precision, deliberately unrounded: a column is summed before it is displayed, and rounding each
 * term first makes a long list drift by a currency unit or two. Rounding happens once, at the end.
 */
export function convertAmount(
	amount: number,
	from: string | undefined,
	to: string | undefined,
	table: RateTable | null
): number | null {
	const rate = rateBetween(table, from, to)
	if (rate === null || !Number.isFinite(amount)) return null
	return amount * rate
}

/**
 * Hand-entered rates layered over fetched ones.
 *
 * Manual wins, always — someone who types a rate is recording the one they actually got, and a daily
 * mid-market figure has no business overruling it. This is also what keeps the feature usable with the
 * network switched off entirely.
 */
export function mergeRates(table: RateTable | null, manual: ManualRates | undefined): RateTable | null {
	const entries = Object.entries(manual ?? {}).filter(
		([, rate]) => Number.isFinite(rate) && rate > 0
	)
	if (!entries.length) return table
	const base = normaliseCurrency(table?.base) ?? 'USD'
	return {
		base,
		rates: { ...(table?.rates ?? {}), ...Object.fromEntries(entries) },
		asOf: table?.asOf ?? Date.now(),
		stale: table?.stale ?? false,
	}
}

/** The distinct currencies in a set of amounts, in first-seen order. */
export function currenciesUsed(units: readonly (string | undefined)[]): string[] {
	const seen = new Set<string>()
	for (const unit of units) {
		const code = normaliseCurrency(unit)
		if (code) seen.add(code)
	}
	return [...seen]
}
