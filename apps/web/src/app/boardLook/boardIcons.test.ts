import { describe, expect, it } from 'vitest'
import { BOARD_ICONS, boardIcon, searchBoardIcons } from './boardIcons'

const names = (query: string) => searchBoardIcons(query).map((icon) => icon.name)

describe('board icons', () => {
	it('has a few hundred, each name once', () => {
		expect(BOARD_ICONS.length).toBeGreaterThan(200)
		expect(new Set(BOARD_ICONS.map((icon) => icon.name)).size).toBe(BOARD_ICONS.length)
	})

	it('finds an icon by what it is for, by its name, and by the start of a word', () => {
		expect(names('gym')).toContain('dumbbell')
		expect(names('dumbbell')).toEqual(['dumbbell'])
		expect(names('fit')).toContain('dumbbell')
		expect(names('sea boat')).toContain('sailboat')
	})

	it('matches word starts only, and needs every word', () => {
		expect(names('ell')).not.toContain('dumbbell')
		expect(names('gym pizza')).toEqual([])
	})

	it('treats an empty query as everything', () => {
		expect(searchBoardIcons('  ')).toBe(BOARD_ICONS)
	})

	it('looks up a stored name, and has nothing for one it does not know', () => {
		expect(boardIcon('dumbbell')?.name).toBe('dumbbell')
		expect(boardIcon('no-such-icon')).toBeUndefined()
		expect(boardIcon(undefined)).toBeUndefined()
	})
})
