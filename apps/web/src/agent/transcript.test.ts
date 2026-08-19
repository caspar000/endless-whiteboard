import { describe, expect, it } from 'vitest'
import type { TranscriptRow, Turn } from './chat'
import {
	MAX_COLLAPSED_MESSAGE_CHARS,
	MAX_COLLAPSED_MESSAGE_LINES,
	foldLabel,
	formatElapsed,
	isNoiseStatus,
	shouldCollapseMessage,
	toDisplayItems,
} from './transcript'

/**
 * How the transcript is shown.
 *
 * These are the rules a reader of the panel experiences directly — whether their request collapses,
 * whether a research turn reads as one piece of work or as a ladder, what a finished turn says about
 * itself — so they are pinned here rather than left to be judged by eye in a screenshot.
 */

const TURN: Turn = { id: 1, startedAt: 1_000, endedAt: null, interrupted: false }

function user(turn = 1, text = 'do a thing'): TranscriptRow {
	return { kind: 'user', id: `u${turn}`, turn, at: 1_000, text }
}
function tool(id: string, turn = 1): TranscriptRow {
	return { kind: 'tool', id, turn, name: 'mcp__lifeboard__node_insert', input: {}, state: 'ok', summary: '' }
}
function agent(id: string, turn = 1): TranscriptRow {
	return { kind: 'agent', id, turn, text: 'Added four notes.', streaming: false }
}
function status(id: string, text: string, turn = 1): TranscriptRow {
	return { kind: 'status', id, turn, text }
}

describe('collapsing a long message', () => {
	it('leaves a short request whole', () => {
		expect(shouldCollapseMessage('add a note per city')).toBe(false)
	})

	it('collapses on length', () => {
		expect(shouldCollapseMessage('x'.repeat(MAX_COLLAPSED_MESSAGE_CHARS + 1))).toBe(true)
		expect(shouldCollapseMessage('x'.repeat(MAX_COLLAPSED_MESSAGE_CHARS))).toBe(false)
	})

	it('collapses on line count, even when short', () => {
		// A list of twelve one-word bullets is as tall as a 600-character paragraph, which is why the
		// two conditions are an OR rather than an AND.
		const lines = Array.from({ length: MAX_COLLAPSED_MESSAGE_LINES + 1 }, () => 'a').join('\n')
		expect(lines.length).toBeLessThan(MAX_COLLAPSED_MESSAGE_CHARS)
		expect(shouldCollapseMessage(lines)).toBe(true)
	})

	it('never collapses nothing', () => {
		expect(shouldCollapseMessage('   \n  ')).toBe(false)
	})
})

describe('elapsed time', () => {
	it('reads as a person would say it', () => {
		expect(formatElapsed(0)).toBe('0s')
		expect(formatElapsed(42_000)).toBe('42s')
		// Not "1m 0s" — the trailing zero is precision nobody asked for.
		expect(formatElapsed(60_000)).toBe('1m')
		expect(formatElapsed(64_000)).toBe('1m 4s')
		expect(formatElapsed(3_600_000)).toBe('1h')
		expect(formatElapsed(3_960_000)).toBe('1h 6m')
		// Past an hour the seconds stop mattering.
		expect(formatElapsed(3_661_000)).toBe('1h 1m')
	})

	it('never reports negative time', () => {
		expect(formatElapsed(-5_000)).toBe('0s')
	})
})

describe('what a settled turn says about itself', () => {
	it('reports how long it worked', () => {
		expect(foldLabel({ id: 1, startedAt: 1_000, endedAt: 253_000, interrupted: false })).toBe(
			'Worked for 4m 12s'
		)
	})

	it('says the user stopped it, rather than blaming the agent', () => {
		// "Worked for 4s" on a turn somebody cut short reads as the agent giving up.
		expect(foldLabel({ id: 1, startedAt: 1_000, endedAt: 5_000, interrupted: true })).toBe(
			'You stopped after 4s'
		)
	})

	it('still says something without a usable duration', () => {
		// A replayed transcript has no start time — see `openTurn` for the replay case.
		expect(foldLabel({ id: 1, startedAt: 0, endedAt: 5_000, interrupted: false })).toBe('Worked')
		expect(foldLabel({ id: 1, startedAt: 0, endedAt: 5_000, interrupted: true })).toBe(
			'You stopped this response'
		)
	})
})

describe('noise', () => {
	it('recognises the status the agent emits for saying nothing', () => {
		expect(isNoiseStatus('Thinking…')).toBe(true)
		expect(isNoiseStatus('Thinking...')).toBe(true)
		expect(isNoiseStatus('  thinking… ')).toBe(true)
	})

	it('keeps a status that is a real event', () => {
		expect(isNoiseStatus('Turn ended: max tokens')).toBe(false)
	})
})

describe('grouping the transcript', () => {
	it('collapses a run of tool calls into one piece of work', () => {
		const items = toDisplayItems({
			rows: [user(), tool('t1'), tool('t2'), tool('t3'), agent('a1')],
			turns: [TURN],
			expanded: new Set(),
		})

		// The turn is still running, so it also carries the live indicator at its end.
		expect(items.map((item) => item.kind)).toEqual(['row', 'work', 'row', 'working'])
		const work = items[1]
		expect(work?.kind === 'work' && work.tools).toHaveLength(3)
	})

	it('starts a new group when prose interrupts the run', () => {
		// Two groups, not one: the agent said something between them, and merging across that would
		// misrepresent the order it did things in.
		const items = toDisplayItems({
			rows: [user(), tool('t1'), agent('a1'), tool('t2')],
			turns: [TURN],
			expanded: new Set(),
		})
		expect(items.map((item) => item.kind)).toEqual(['row', 'work', 'row', 'work', 'working'])
	})

	it('drops the repeated Thinking… rows', () => {
		const items = toDisplayItems({
			rows: [user(), status('s1', 'Thinking…'), tool('t1'), status('s2', 'Thinking…')],
			turns: [TURN],
			expanded: new Set(),
		})
		expect(items.some((item) => item.kind === 'row' && item.row.kind === 'status')).toBe(false)
	})

	it('keeps a status that means something', () => {
		const items = toDisplayItems({
			rows: [user(), status('s1', 'Turn ended: max tokens')],
			turns: [TURN],
			expanded: new Set(),
		})
		expect(items.some((item) => item.kind === 'row' && item.row.kind === 'status')).toBe(true)
	})

	it('adds a live indicator to the turn still running, carrying its last words', () => {
		const items = toDisplayItems({
			rows: [user(), status('s1', 'Thinking…')],
			turns: [TURN],
			expanded: new Set(),
		})
		const live = items.at(-1)
		expect(live?.kind).toBe('working')
		// The noise that was dropped as a row reappears as the indicator's step label, which is the one
		// place it is worth reading.
		expect(live?.kind === 'working' && live.step).toBe('Thinking…')
		expect(live?.kind === 'working' && live.startedAt).toBe(1_000)
	})

	it('has no live indicator once the turn has ended', () => {
		const items = toDisplayItems({
			rows: [user(), agent('a1')],
			turns: [{ ...TURN, endedAt: 5_000 }],
			expanded: new Set(),
		})
		expect(items.some((item) => item.kind === 'working')).toBe(false)
	})
})

describe('folding a settled turn', () => {
	const settled: Turn = { id: 1, startedAt: 1_000, endedAt: 253_000, interrupted: false }

	it('folds the work and keeps the reply', () => {
		const items = toDisplayItems({
			rows: [user(), tool('t1'), tool('t2'), agent('a1')],
			turns: [settled],
			expanded: new Set(),
		})

		// user, fold, reply — the answer is never behind the fold.
		expect(items.map((item) => item.kind)).toEqual(['row', 'fold', 'row'])
		const fold = items[1]
		expect(fold?.kind === 'fold' && fold.label).toBe('Worked for 4m 12s')
		expect(items.at(-1)).toMatchObject({ kind: 'row', row: { kind: 'agent' } })
	})

	it('shows the work again when opened', () => {
		const items = toDisplayItems({
			rows: [user(), tool('t1'), tool('t2'), agent('a1')],
			turns: [settled],
			expanded: new Set([1]),
		})
		expect(items.map((item) => item.kind)).toEqual(['row', 'fold', 'work', 'row'])
	})

	it('does not fold a single call, which is shorter than its own label', () => {
		const items = toDisplayItems({
			rows: [user(), tool('t1'), agent('a1')],
			turns: [settled],
			expanded: new Set(),
		})
		expect(items.map((item) => item.kind)).toEqual(['row', 'work', 'row'])
	})

	it('leaves the running turn unfolded while the previous one folds', () => {
		const items = toDisplayItems({
			rows: [
				user(1),
				tool('t1', 1),
				tool('t2', 1),
				agent('a1', 1),
				user(2),
				tool('t3', 2),
				tool('t4', 2),
			],
			turns: [settled, { id: 2, startedAt: 300_000, endedAt: null, interrupted: false }],
			expanded: new Set(),
		})

		expect(items.map((item) => item.kind)).toEqual(['row', 'fold', 'row', 'row', 'work', 'working'])
	})

	it('never folds an error out of sight', () => {
		// An error is the one thing a reader must not have to go looking for.
		const items = toDisplayItems({
			rows: [user(), tool('t1'), { kind: 'error', id: 'e1', turn: 1, text: 'it broke' }],
			turns: [settled],
			expanded: new Set(),
		})
		expect(items.some((item) => item.kind === 'row' && item.row.kind === 'error')).toBe(true)
	})
})
