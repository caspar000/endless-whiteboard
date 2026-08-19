import type { TranscriptRow, Turn, TurnId } from './chat'

/**
 * The transcript as it is *shown*, derived from the flat rows the store keeps.
 *
 * The store stays append-only — that is what makes a turn outliving the panel safe — so everything
 * about presentation lives here instead: which rows are one piece of work, which repeated status
 * text is noise, how long a turn took, what a finished turn folds away. Derived at read time rather
 * than baked in, because the same rows are shown differently depending on whether their turn has
 * ended.
 *
 * All pure, all tested. This is the file to read to understand why the transcript looks the way it
 * does, and the file to change when it should look different.
 */

// ---------------------------------------------------------------------------
// Long user messages
// ---------------------------------------------------------------------------

/**
 * Where a request stops being a message and starts being a wall.
 *
 * T3 Code's thresholds, and worth keeping rather than tuning by eye: they are what makes a
 * three-sentence request stay whole while a pasted brief collapses. Either condition is enough — a
 * short-lined list of twelve bullets is as tall as a 600-character paragraph.
 */
export const MAX_COLLAPSED_MESSAGE_CHARS = 600
export const MAX_COLLAPSED_MESSAGE_LINES = 8

export function shouldCollapseMessage(text: string): boolean {
	if (text.trim().length === 0) return false
	return (
		text.length > MAX_COLLAPSED_MESSAGE_CHARS ||
		text.split('\n').length > MAX_COLLAPSED_MESSAGE_LINES
	)
}

// ---------------------------------------------------------------------------
// Durations
// ---------------------------------------------------------------------------

/**
 * An elapsed time as the panel says it.
 *
 * Seconds only under a minute, because "0m 42s" reads as precision nobody asked for; minutes and
 * seconds up to an hour; hours and minutes past that, dropping the smaller unit when it is zero so
 * "2m" does not become "2m 0s".
 */
export function formatElapsed(ms: number): string {
	const seconds = Math.max(0, Math.floor(ms / 1000))
	if (seconds < 60) return `${seconds}s`

	const hours = Math.floor(seconds / 3600)
	const minutes = Math.floor((seconds % 3600) / 60)
	const rest = seconds % 60

	if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
	return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`
}

/**
 * What a finished turn's fold row says.
 *
 * The interrupted wording is not cosmetic: "Worked for 4s" on a turn the user cut short reads as the
 * agent having given up, when in fact they stopped it.
 */
export function foldLabel(turn: Turn): string {
	const elapsed = turn.endedAt !== null && turn.startedAt > 0 ? turn.endedAt - turn.startedAt : null
	const duration = elapsed !== null ? formatElapsed(elapsed) : null

	if (turn.interrupted) return duration ? `You stopped after ${duration}` : 'You stopped this response'
	return duration ? `Worked for ${duration}` : 'Worked'
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

/**
 * One thing to render.
 *
 * `work` is the whole point: a run of tool calls is one piece of work with one heading and one
 * disclosure, not five rows that happen to be adjacent. A research turn used to produce a ladder of
 * `Thinking… / tool / tool / Thinking…`; this is what flattens it.
 */
export type DisplayItem =
	| { kind: 'row'; row: TranscriptRow }
	/** A run of consecutive tool calls from one turn. */
	| { kind: 'work'; turn: TurnId; id: string; tools: readonly Extract<TranscriptRow, { kind: 'tool' }>[] }
	/** The live indicator, at the end of a running turn. Carries the latest status text, if any. */
	| { kind: 'working'; turn: TurnId; startedAt: number; step: string | null }
	/** A finished turn's `Worked for …` disclosure. Everything it hides is in `hidden`. */
	| { kind: 'fold'; turn: TurnId; label: string; hidden: readonly DisplayItem[] }

/**
 * Whether a status row is worth showing on its own.
 *
 * `Thinking…` is the agent saying nothing in particular, repeated once per block; T3 Code filters the
 * equivalent out for the same reason. Anything else — "Turn ended: max tokens" — is a real event and
 * survives. The live indicator carries the noise instead, as its trailing step label.
 */
export function isNoiseStatus(text: string): boolean {
	return /^thinking…?\.*$/i.test(text.trim())
}

/**
 * The transcript, grouped and folded.
 *
 * One pass, in order. A turn that has ended and holds more than its reply becomes a `fold`; the turn
 * still running grows a `working` indicator at its end.
 */
export function toDisplayItems(input: {
	rows: readonly TranscriptRow[]
	turns: readonly Turn[]
	/** Turn ids the user has expanded. A fold is closed unless it is in here. */
	expanded: ReadonlySet<TurnId>
}): DisplayItem[] {
	const turnById = new Map(input.turns.map((turn) => [turn.id, turn]))
	const items: DisplayItem[] = []

	// Pass one: rows to items, coalescing runs of tool calls.
	for (const row of input.rows) {
		if (row.kind === 'status' && isNoiseStatus(row.text)) continue

		if (row.kind === 'tool') {
			const last = items[items.length - 1]
			if (last?.kind === 'work' && last.turn === row.turn) {
				items[items.length - 1] = { ...last, tools: [...last.tools, row] }
				continue
			}
			items.push({ kind: 'work', turn: row.turn, id: `work-${row.id}`, tools: [row] })
			continue
		}

		items.push({ kind: 'row', row })
	}

	// Pass two: the live indicator for a turn still running.
	const live = input.turns.find((turn) => turn.endedAt === null)
	if (live) {
		const step = lastStatusOf(input.rows, live.id)
		items.push({ kind: 'working', turn: live.id, startedAt: live.startedAt, step })
	}

	// Pass three: fold the settled turns.
	return foldSettledTurns(items, turnById, input.expanded)
}

/** The most recent status text in a turn, noise included — it is what the live row narrates. */
function lastStatusOf(rows: readonly TranscriptRow[], turn: TurnId): string | null {
	for (let index = rows.length - 1; index >= 0; index -= 1) {
		const row = rows[index]
		if (!row || row.turn !== turn) continue
		if (row.kind === 'status') return row.text
		// A tool call or a reply means the agent has moved on from whatever it last said.
		if (row.kind === 'tool' || row.kind === 'agent') return null
	}
	return null
}

/**
 * Replaces each settled turn's working items with one `fold`, keeping its final reply visible.
 *
 * That last part is the design: you fold away *how* it was done, never *what it said*. A fold that
 * hid the answer would be a fold nobody opens twice.
 */
function foldSettledTurns(
	items: readonly DisplayItem[],
	turnById: ReadonlyMap<TurnId, Turn>,
	expanded: ReadonlySet<TurnId>
): DisplayItem[] {
	const out: DisplayItem[] = []
	let index = 0

	while (index < items.length) {
		const item = items[index]
		if (!item) break

		const turnId = turnIdOf(item)
		const turn = turnId === null ? undefined : turnById.get(turnId)
		// Only a turn that has finished folds — and only the parts of it that are foldable.
		if (!turn || turn.endedAt === null || !isFoldable(item)) {
			out.push(item)
			index += 1
			continue
		}

		const run: DisplayItem[] = []
		while (index < items.length) {
			const next = items[index]
			if (!next || turnIdOf(next) !== turnId || !isFoldable(next)) break
			run.push(next)
			index += 1
		}

		// One tool call and nothing else is not worth a disclosure — it is shorter than its own label.
		const worthFolding = run.length > 1 || run.some((entry) => entry.kind === 'work' && entry.tools.length > 1)
		if (!worthFolding) {
			out.push(...run)
			continue
		}

		out.push({ kind: 'fold', turn: turn.id, label: foldLabel(turn), hidden: run })
		if (expanded.has(turn.id)) out.push(...run)
	}

	return out
}

/**
 * What a fold may hide: the work and the commentary, never the user's message and never the reply.
 *
 * `agent` rows are excluded wholesale rather than "all but the last", because a turn can close with
 * prose after its tools and hiding that would hide the answer.
 */
function isFoldable(item: DisplayItem): boolean {
	if (item.kind === 'work') return true
	if (item.kind === 'row') return item.row.kind === 'status'
	return false
}

function turnIdOf(item: DisplayItem): TurnId | null {
	return item.kind === 'row' ? item.row.turn : item.turn
}
