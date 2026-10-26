import { describe, expect, it } from 'vitest'
import { searchBoards } from './boardSearch'

const boards = [{ name: 'Trip planning' }, { name: 'Café menu' }, { name: 'Gym log' }, { name: 'Weekly plan' }]
const names = (query: string) => searchBoards(boards, query).map((board) => board.name)

describe('searchBoards', () => {
	it('matches every board for an empty or blank query', () => {
		expect(names('')).toEqual(boards.map((board) => board.name))
		expect(names('   ')).toEqual(boards.map((board) => board.name))
	})

	it('matches part of a word, whatever the case, keeping the order', () => {
		expect(names('PLAN')).toEqual(['Trip planning', 'Weekly plan'])
		expect(names('gy')).toEqual(['Gym log'])
	})

	it('needs every word, in any order', () => {
		expect(names('plan trip')).toEqual(['Trip planning'])
		expect(names('plan gym')).toEqual([])
	})

	it('ignores accents on either side', () => {
		expect(names('cafe')).toEqual(['Café menu'])
		expect(names('café')).toEqual(['Café menu'])
	})
})
