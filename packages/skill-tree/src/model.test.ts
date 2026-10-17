import { describe, expect, it } from 'vitest'
import {
	childProgress,
	formatChildRule,
	formatOrder,
	formatProgress,
	formatTags,
	hasEvidence,
	makeItemId,
	nextInOrder,
	parseChildRule,
	parseOrder,
	parseTags,
	todayIso,
} from './model'

describe('child rules', () => {
	it('round-trips through the stored string', () => {
		for (const raw of ['core', 'all', 'n:3']) expect(formatChildRule(parseChildRule(raw))).toBe(raw)
	})

	it('reads anything unknown as core, and clamps n to at least one', () => {
		expect(parseChildRule('')).toEqual({ kind: 'core' })
		expect(parseChildRule('n:0')).toEqual({ kind: 'n', n: 1 })
	})
})

describe('childProgress', () => {
	const kids = (spec: string) => [...spec].map((c) => ({ done: c === 'X' || c === 'x', core: c === 'X' || c === 'O' }))

	it('is complete under core when every core child is done, whatever else is', () => {
		// X = core done, O = core undone, x = done, o = undone
		expect(childProgress(kids('Xooo'), { kind: 'core' }).complete).toBe(true)
		expect(childProgress(kids('XOxx'), { kind: 'core' }).complete).toBe(false)
	})

	it('falls back to all when nothing is core', () => {
		expect(childProgress(kids('xxo'), { kind: 'core' }).complete).toBe(false)
		expect(childProgress(kids('xxx'), { kind: 'core' }).complete).toBe(true)
	})

	it('counts n of them, capped at how many there are', () => {
		expect(childProgress(kids('xxoo'), { kind: 'n', n: 2 }).complete).toBe(true)
		expect(childProgress(kids('xo'), { kind: 'n', n: 5 }).complete).toBe(false)
		expect(childProgress(kids('xx'), { kind: 'n', n: 5 }).complete).toBe(true)
	})

	it('never calls a parent with no children done', () => {
		expect(childProgress([], { kind: 'all' }).complete).toBe(false)
	})

	it('formats with the core count only when there is a core', () => {
		expect(formatProgress(childProgress(kids('XOxo'), { kind: 'core' }))).toBe('2/4 · core 1/2')
		expect(formatProgress(childProgress(kids('xo'), { kind: 'core' }))).toBe('1/2')
	})
})

describe('hasEvidence', () => {
	const template = '## What is it about?\n\n## What does it say?\n\n- \n'

	it('ignores the template, blank lines and bare list markers', () => {
		expect(hasEvidence(template, template)).toBe(false)
		expect(hasEvidence('', template)).toBe(false)
		expect(hasEvidence('## What is it about?\n- [ ]\n\n', template)).toBe(false)
	})

	it('sees one written line anywhere', () => {
		expect(hasEvidence(`${template}\nA city as a soul.`, template)).toBe(true)
		expect(hasEvidence('## What is it about?\n- justice', template)).toBe(true)
	})

	it('ignores the title the note is filed under', () => {
		expect(hasEvidence(`# Poetics\n\n${template}`, template)).toBe(false)
	})

	it('treats whitespace differences as the same line', () => {
		expect(hasEvidence('##   What is it about?   ', template)).toBe(false)
	})
})

describe('order and tags', () => {
	it('round-trip and drop duplicates and blanks', () => {
		expect(parseOrder(formatOrder(['a', 'b', 'a', '']))).toEqual(['a', 'b'])
		expect(parseTags(formatTags([' x', 'y', 'x', '']))).toEqual(['x', 'y'])
	})

	it('finds the first undone id the board knows', () => {
		const known: Record<string, boolean> = { a: true, c: false, d: false }
		expect(nextInOrder(['a', 'b', 'c', 'd'], (id) => known[id])).toBe('c')
		expect(nextInOrder(['a'], (id) => known[id])).toBeNull()
	})
})

describe('makeItemId', () => {
	it('is a slug of the title plus a suffix', () => {
		expect(makeItemId('Plato, Dialogues', 'adler/', () => 0)).toBe('adler/plato-dialogues-0000')
		expect(makeItemId('!!!', '', () => 0)).toBe('item-0000')
	})
})

it('todayIso is the local calendar day', () => {
	expect(todayIso(new Date(2026, 9, 7))).toBe('2026-10-07')
})
