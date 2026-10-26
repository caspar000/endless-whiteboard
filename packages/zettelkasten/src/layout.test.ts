import { describe, expect, it } from 'vitest'
import { BRANCH_INDENT, CARD_GAP, CARD_H, CARD_W, tableLayout } from './layout'

const ROW = CARD_H + CARD_GAP

describe('tableLayout', () => {
	it('puts each top-level note at the head of its own column, its line running down it', () => {
		const at = tableLayout(['25', '25a', '25b', '26', '26a'])
		expect(at.get('25')).toEqual({ x: 0, y: 0 })
		expect(at.get('25a')).toEqual({ x: BRANCH_INDENT, y: ROW })
		expect(at.get('25b')).toEqual({ x: BRANCH_INDENT, y: 2 * ROW })
		const second = CARD_W + BRANCH_INDENT + CARD_GAP
		expect(at.get('26')).toEqual({ x: second, y: 0 })
		expect(at.get('26a')).toEqual({ x: second + BRANCH_INDENT, y: ROW })
	})

	it('steps deeper branches further right, in reading order', () => {
		const at = tableLayout(['1', '1a', '1a1', '1a1a', '1b'])
		expect(at.get('1a1')).toEqual({ x: 2 * BRANCH_INDENT, y: 2 * ROW })
		expect(at.get('1a1a')).toEqual({ x: 3 * BRANCH_INDENT, y: 3 * ROW })
		expect(at.get('1b')).toEqual({ x: BRANCH_INDENT, y: 4 * ROW })
	})

	it('gives the same answer for the same ids, so every device writes the same positions', () => {
		const ids = ['1', '1a', '2', '3', '3a', '3a1']
		expect([...tableLayout(ids)]).toEqual([...tableLayout([...ids])])
	})
})
