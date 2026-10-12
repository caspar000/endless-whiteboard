import { describe, expect, it } from 'vitest'
import { isBoardColor, withLook, type BoardMeta } from './boardIndex'

const board: BoardMeta = { id: 'b', name: 'Gym', createdAt: 1, updatedAt: 2 }

describe('withLook', () => {
	it('sets, keeps and clears a colour and an icon', () => {
		const styled = withLook(board, { color: '#e5484d', icon: 'dumbbell' })
		expect(styled).toEqual({ ...board, color: '#e5484d', icon: 'dumbbell' })
		// A missing key leaves that half alone; null takes it off rather than storing null.
		expect(withLook(styled, { icon: 'bike' })).toEqual({ ...board, color: '#e5484d', icon: 'bike' })
		expect(withLook(styled, { color: null })).toEqual({ ...board, icon: 'dumbbell' })
		expect('color' in withLook(styled, { color: null })).toBe(false)
	})

	it('is not an edit', () => {
		expect(withLook(board, { color: '#e5484d' }).updatedAt).toBe(board.updatedAt)
	})
})

describe('isBoardColor', () => {
	it('takes #rrggbb and nothing else', () => {
		expect(isBoardColor('#30A46C')).toBe(true)
		for (const bad of ['red', '#fff', 'url(x)', '#30A46C; x', null, 3]) expect(isBoardColor(bad)).toBe(false)
	})
})
