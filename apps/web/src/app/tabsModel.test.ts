import { describe, expect, it } from 'vitest'
import {
	closeTabs,
	dropUnknownBoards,
	EMPTY_TABS,
	followRoute,
	moveTab,
	openTab,
	otherTabIds,
	parseTabs,
	tabAlong,
	tabIdsAfter,
	type TabsState,
} from './tabsModel'

const board = (boardId: string) => ({ view: 'board' as const, boardId })

/** Tabs `a`, `b`, `c` on boards A, B, C, with `b` active. */
const three: TabsState = {
	tabs: [
		{ id: 'a', route: board('A') },
		{ id: 'b', route: board('B') },
		{ id: 'c', route: board('C') },
	],
	activeId: 'b',
}

const routes = (state: TabsState) => state.tabs.map((tab) => tab.route)

describe('parseTabs', () => {
	it('reads the old list of board ids', () => {
		const state = parseTabs(JSON.stringify(['A', 'daily', 'B', 'A']))
		expect(routes(state)).toEqual([board('A'), { view: 'daily' }, board('B')])
		expect(state.activeId).toBeNull()
	})

	it('keeps what holds together', () => {
		const raw = JSON.stringify({
			tabs: [{ id: 'a', route: board('A') }, { id: 'x', route: { view: 'settings' } }, { id: 'n', route: { view: 'list' } }],
			activeId: 'x',
		})
		const state = parseTabs(raw)
		expect(state.tabs.map((tab) => tab.id)).toEqual(['a', 'n'])
		expect(state.activeId).toBeNull()
	})

	it('falls back to no tabs', () => {
		expect(parseTabs('not json')).toEqual(EMPTY_TABS)
		expect(parseTabs(null)).toEqual(EMPTY_TABS)
	})
})

describe('followRoute', () => {
	it('opens a board at the end of the row', () => {
		const state = followRoute(three, board('D'))
		expect(routes(state).at(-1)).toEqual(board('D'))
		expect(state.activeId).toBe(state.tabs.at(-1)!.id)
	})

	it('shows a board that is already open', () => {
		expect(followRoute(three, board('A'))).toEqual({ ...three, activeId: 'a' })
	})

	it('changes nothing for the board on screen', () => {
		expect(followRoute(three, board('B'))).toBe(three)
	})

	it('turns a New tab into the board picked in it', () => {
		const withNew = openTab(three, { view: 'list' }, { id: 'n' })
		const state = followRoute(withNew, board('D'))
		expect(state.tabs.find((tab) => tab.id === 'n')!.route).toEqual(board('D'))
		expect(state.activeId).toBe('n')
	})

	it('closes the New tab when its board is open elsewhere', () => {
		const withNew = openTab(three, { view: 'list' }, { id: 'n' })
		const state = followRoute(withNew, board('A'))
		expect(state.tabs.map((tab) => tab.id)).toEqual(['a', 'b', 'c'])
		expect(state.activeId).toBe('a')
	})

	it('keeps a New tab on the home screen, and leaves a board tab for All Boards', () => {
		const withNew = openTab(three, { view: 'list' }, { id: 'n' })
		expect(followRoute(withNew, { view: 'list' })).toBe(withNew)
		expect(followRoute(three, { view: 'list' }).activeId).toBeNull()
		expect(followRoute(three, { view: 'settings' }).activeId).toBeNull()
	})

	it('remembers the day the daily page was on', () => {
		const daily = followRoute(three, { view: 'daily', day: '2026-11-24' })
		const again = followRoute(daily, { view: 'daily', day: '2026-11-25', review: true })
		expect(again.tabs).toHaveLength(4)
		expect(again.tabs.at(-1)!.route).toEqual({ view: 'daily', day: '2026-11-25', review: true })
	})
})

describe('openTab', () => {
	it('opens behind the active tab, once per board', () => {
		const state = openTab(three, board('D'), { background: true })
		expect(state.activeId).toBe('b')
		expect(openTab(state, board('D'), { background: true })).toBe(state)
	})

	it('always opens a new New tab', () => {
		const once = openTab(three, { view: 'list' })
		expect(openTab(once, { view: 'list' }).tabs).toHaveLength(5)
	})
})

describe('closeTabs', () => {
	it('hands over to the tab that took its place, else the one before', () => {
		expect(closeTabs(three, ['b']).activeId).toBe('c')
		expect(closeTabs({ ...three, activeId: 'c' }, ['c']).activeId).toBe('b')
		expect(closeTabs(three, ['a', 'b', 'c']).activeId).toBeNull()
	})

	it('leaves the active tab when another closes', () => {
		expect(closeTabs(three, ['a'])).toEqual({ tabs: three.tabs.slice(1), activeId: 'b' })
	})

	it('closes others and those to the right', () => {
		expect(otherTabIds(three, 'b')).toEqual(['a', 'c'])
		expect(tabIdsAfter(three, 'a')).toEqual(['b', 'c'])
		expect(tabIdsAfter(three, 'c')).toEqual([])
	})
})

describe('moveTab', () => {
	it('moves a tab along the row', () => {
		expect(moveTab(three, 'a', 2).tabs.map((tab) => tab.id)).toEqual(['b', 'c', 'a'])
		expect(moveTab(three, 'c', 0).tabs.map((tab) => tab.id)).toEqual(['c', 'a', 'b'])
		expect(moveTab(three, 'b', 1)).toBe(three)
	})
})

describe('tabAlong', () => {
	it('wraps around the row', () => {
		expect(tabAlong(three, 1)!.id).toBe('c')
		expect(tabAlong({ ...three, activeId: 'c' }, 1)!.id).toBe('a')
		expect(tabAlong({ ...three, activeId: null }, -1)!.id).toBe('c')
	})
})

describe('dropUnknownBoards', () => {
	it('drops tabs of boards that are gone', () => {
		const state = dropUnknownBoards(three, new Set(['A', 'C']))
		expect(state.tabs.map((tab) => tab.id)).toEqual(['a', 'c'])
		expect(state.activeId).toBeNull()
		expect(dropUnknownBoards(three, new Set(['A', 'B', 'C']))).toBe(three)
	})
})
