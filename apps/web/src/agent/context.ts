/**
 * How full the conversation's context window is.
 *
 * The panel shows this as a ring beside the send button, the way T3 Code does — and for the same
 * reason: a long conversation degrades before it fails, and the moment worth knowing about is *before*
 * the model starts forgetting the top of the thread. The number is an estimate and is presented as
 * one (a percentage and a token count, no promises).
 *
 * The arithmetic lives here rather than in the component because it is the part that can be wrong in
 * a way nobody notices: a ring at 40% when the truth is 90% is worse than no ring.
 */

export interface ContextUsage {
	/** Tokens occupying the window after the last turn. */
	used: number
	/** The window's size, or `null` when the host could not report one. */
	max: number | null
}

export interface ContextSnapshot extends ContextUsage {
	/** `null` without a `max`, because a percentage of an unknown total is not a number. */
	percent: number | null
	/** Past this, the ring turns red. Compaction is close, and so is a degraded answer. */
	crowded: boolean
}

/** Where the ring stops being informational and starts being a warning. */
export const CROWDED_PERCENT = 90

export function snapshot(usage: ContextUsage): ContextSnapshot {
	const used = Math.max(0, usage.used)
	const max = usage.max !== null && usage.max > 0 ? usage.max : null
	// Clamped at 100: a turn that overshot the window (compaction lands after the fact) should read as
	// full rather than as an impossible 104%.
	const percent = max === null ? null : Math.min(100, (used / max) * 100)
	return { used, max, percent, crowded: percent !== null && percent > CROWDED_PERCENT }
}

/**
 * A token count as a person reads it.
 *
 * Lifted from T3 Code's `formatContextWindowTokens`, including the one-decimal band below 10k — the
 * difference between 1.2k and 1k matters at the start of a conversation and stops mattering entirely
 * by 40k.
 */
export function formatTokens(value: number | null): string {
	if (value === null || !Number.isFinite(value)) return '0'
	if (value < 1_000) return `${Math.round(value)}`
	if (value < 10_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}k`
	if (value < 1_000_000) return `${Math.round(value / 1_000)}k`
	return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`
}

/** `12%`, or `1.4%` near the bottom of the scale where a whole number would round to nothing. */
export function formatPercent(percent: number | null): string | null {
	if (percent === null || !Number.isFinite(percent)) return null
	return percent < 10
		? `${percent.toFixed(1).replace(/\.0$/, '')}%`
		: `${Math.round(percent)}%`
}

/** The ring's own accessible name, and the text of its tooltip. */
export function describeContext(snap: ContextSnapshot): string {
	const percent = formatPercent(snap.percent)
	if (snap.max === null) return `Context: ${formatTokens(snap.used)} tokens used`
	return `Context: ${percent} used — ${formatTokens(snap.used)} of ${formatTokens(snap.max)} tokens`
}
