import { describe, expect, it } from 'vitest'
import type { BoxEntry } from './box'
import { chainPath, lineFrom } from './chain'

const box = (...zids: string[]): Pick<BoxEntry, 'zid' | 'kind'>[] => [
	{ zid: 'index', kind: 'index' },
	...zids.map((zid) => ({
		zid: zid.replace('~', ''),
		kind: zid.startsWith('~') ? ('gap' as const) : zid.startsWith('c') ? ('source' as const) : ('note' as const),
	})),
]

describe('the chain', () => {
	const order = box('1', '1a', '~1b', '1b1', '1c', '2', '2a', '3', 'c1')

	it('reads a note’s train of thought from it, branches included, past gaps, up to the next train', () => {
		expect(lineFrom(order, '1a')).toEqual(['1a', '1b1', '1c'])
		expect(lineFrom(order, '2')).toEqual(['2', '2a'])
		expect(lineFrom(order, '3')).toEqual(['3'])
		expect(lineFrom(order, 'c1')).toEqual(['c1'])
		expect(lineFrom(order, '9')).toEqual([])
	})

	it('turns off the path at a row, and carries on from the note the link points at', () => {
		expect(chainPath(order, [{ at: null, to: '1' }])).toEqual(['1', '1a', '1b1', '1c'])
		// From 1a (row 1) to 2: what came after 1a is dropped.
		expect(
			chainPath(order, [
				{ at: null, to: '1' },
				{ at: 1, to: '2' },
			])
		).toEqual(['1', '1a', '2', '2a'])
		// A path can come back round to where it has been.
		expect(
			chainPath(order, [
				{ at: null, to: '1' },
				{ at: 1, to: '2' },
				{ at: 3, to: '1a' },
			])
		).toEqual(['1', '1a', '2', '2a', '1a', '1b1', '1c'])
	})
})
