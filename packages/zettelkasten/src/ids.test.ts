import { describe, expect, it } from 'vitest'
import {
	branchOf,
	compareZids,
	depthOf,
	indexToLetters,
	isCiteId,
	isZid,
	lettersToIndex,
	nextCite,
	nextOnLine,
	nextTrain,
	parentOf,
	parseZid,
	placeAfterDuplicate,
	placeBehind,
	rootOf,
} from './ids'

describe('ids', () => {
	it('reads ids that alternate numbers and letters, starting with a number', () => {
		expect(parseZid('25')).toEqual([25])
		expect(parseZid('25a1b')).toEqual([25, 'a', 1, 'b'])
		expect(parseZid('3aa12')).toEqual([3, 'aa', 12])
		for (const bad of ['', 'a', '0', '025', '25A', '25a0', '25 a', 'c1', '25-a']) expect(isZid(bad)).toBe(false)
	})

	it('counts letters in bijective base 26', () => {
		expect(lettersToIndex('a')).toBe(1)
		expect(lettersToIndex('z')).toBe(26)
		expect(lettersToIndex('aa')).toBe(27)
		expect(lettersToIndex('az')).toBe(52)
		expect(lettersToIndex('ba')).toBe(53)
		for (let n = 1; n < 2000; n++) expect(lettersToIndex(indexToLetters(n))).toBe(n)
	})

	it('sorts a note before its branches, and its branches before the next note on its line', () => {
		const box = ['26', '25b', '25a1', '25', '25a', '25a2', '2', '10', '25z', '25aa', '25a1a', 'junk']
		expect([...box].sort(compareZids)).toEqual([
			'2',
			'10',
			'25',
			'25a',
			'25a1',
			'25a1a',
			'25a2',
			'25b',
			'25z',
			'25aa',
			'26',
			'junk',
		])
	})

	it('knows a note’s place in the tree', () => {
		expect(depthOf('25')).toBe(0)
		expect(depthOf('25a1')).toBe(2)
		expect(parentOf('25')).toBeNull()
		expect(parentOf('25a1')).toBe('25a')
		expect(rootOf('25a1b')).toBe('25')
		expect(nextOnLine('25')).toBe('26')
		expect(nextOnLine('25z')).toBe('25aa')
		expect(nextOnLine('25a9')).toBe('25a10')
		expect(branchOf('25', 1)).toBe('25a')
		expect(branchOf('25a', 3)).toBe('25a3')
	})

	it('puts a new note on the line behind X when that place is free', () => {
		expect(placeBehind('25a', new Set(['25', '25a']))).toBe('25b')
		expect(placeBehind('25', new Set(['25']))).toBe('26')
	})

	it('branches off X when its line is already taken, after X’s other branches', () => {
		expect(placeBehind('25a', new Set(['25', '25a', '25b']))).toBe('25a1')
		expect(placeBehind('25a', new Set(['25', '25a', '25b', '25a1', '25a2']))).toBe('25a3')
		expect(placeBehind('25', new Set(['25', '26']))).toBe('25a')
	})

	it('never gives out a retired id again', () => {
		// 25b was deleted: it is in the taken set, so the new note branches instead.
		expect(placeBehind('25a', new Set(['25', '25a', '25b']))).toBe('25a1')
		expect(nextTrain(['1', '2', '7'])).toBe('8')
	})

	it('starts an empty box at 1, and a new train after the highest number ever used', () => {
		expect(nextTrain([])).toBe('1')
		expect(nextTrain(['3', '12a', '4b1'])).toBe('13')
	})

	it('puts a note that lost its id to another device straight behind the other one', () => {
		expect(placeAfterDuplicate('25b', new Set(['25', '25a', '25b']))).toBe('25c')
		expect(placeAfterDuplicate('25b', new Set(['25', '25a', '25b', '25c']))).toBe('25b1')
		expect(placeAfterDuplicate('27', new Set(['25', '26', '27']))).toBe('28')
	})

	it('keeps the sources a series of their own, at the back of the box', () => {
		expect(isCiteId('c1')).toBe(true)
		expect(isCiteId('c0')).toBe(false)
		expect(isZid('c1')).toBe(false)
		expect(['c10', '2', 'c2', '1a', 'c1'].sort(compareZids)).toEqual(['1a', '2', 'c1', 'c2', 'c10'])
		expect(nextCite(['1', '2'])).toBe('c1')
		expect(nextCite(['1', 'c1', 'c4'])).toBe('c5')
		// Sources don't count towards the next train of thought.
		expect(nextTrain(['1', 'c7'])).toBe('2')
	})
})
