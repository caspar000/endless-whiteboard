import { describe, expect, it } from 'vitest'
import {
	closeTabs,
	openBeside,
	paneRects,
	resizeSplit,
	rowEntries,
	splitTabs,
	unsplit,
	visibleTabs,
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
	splits: [],
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
		expect(closeTabs(three, ['a'])).toEqual({ ...three, tabs: three.tabs.slice(1) })
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

const ids = (state: TabsState) => state.tabs.map((tab) => tab.id)
const row = (state: TabsState) =>
	rowEntries(state).map((entry) => (entry.kind === 'split' ? entry.tabs.map((tab) => tab.id).join('|') : entry.tab.id))

describe('splits', () => {
	it('shows two tabs side by side, together in the row, the left one focused', () => {
		const state = splitTabs(three, 'c', 'a')
		expect(state.splits).toEqual([{ tabs: ['c', 'a'], size: 50 }])
		expect(state.activeId).toBe('c')
		expect(ids(state)).toEqual(['b', 'c', 'a'])
		expect(row(state)).toEqual(['b', 'c|a'])
		expect(visibleTabs(state).map((tab) => tab.id)).toEqual(['c', 'a'])
		expect(visibleTabs({ ...state, activeId: 'b' }).map((tab) => tab.id)).toEqual(['b'])
	})

	it('takes a tab out of the split it was in', () => {
		const ab = splitTabs(three, 'a', 'b')
		const bc = splitTabs(ab, 'b', 'c')
		expect(bc.splits).toEqual([{ tabs: ['b', 'c'], size: 50 }])
	})

	it('opens a page beside a tab, and stacks more in the right column', () => {
		const once = openBeside(three, 'a', board('D'), 'd')
		expect(once.splits).toEqual([{ tabs: ['a', 'd'], size: 50 }])
		expect(once.activeId).toBe('d')
		expect(ids(once)).toEqual(['a', 'd', 'b', 'c'])
		// A board already open joins rather than opening twice.
		const twice = openBeside(once, 'd', board('C'))
		expect(twice.splits).toEqual([{ tabs: ['a', 'd', 'c'], size: 50 }])
		expect(ids(twice)).toEqual(['a', 'd', 'c', 'b'])
		expect(paneRects(twice.splits[0]!).get('c')).toEqual({ left: 50, width: 50, top: 50, height: 50 })
	})

	it('hands focus to a partner pane when the focused one closes, and ends a split left alone', () => {
		const state = { ...splitTabs(three, 'a', 'c'), activeId: 'c' }
		const closed = closeTabs(state, ['c'])
		expect(closed.activeId).toBe('a')
		expect(closed.splits).toEqual([])
	})

	it('moves a split as one label', () => {
		const state = splitTabs(three, 'a', 'b')
		// Row without the split: c. After it.
		expect(ids(moveTab(state, 'b', 1))).toEqual(['c', 'a', 'b'])
		// c before the split.
		expect(ids(moveTab(state, 'c', 0))).toEqual(['c', 'a', 'b'])
	})

	it('resizes within bounds, and ends on Exit split', () => {
		const state = splitTabs(three, 'a', 'b')
		expect(resizeSplit(state, 'a', 95).splits[0]!.size).toBe(80)
		expect(unsplit(state, 'b').splits).toEqual([])
	})

	it('keeps a New tab’s pane when a board is picked in it', () => {
		const withNew = openBeside(three, 'a', { view: 'list' }, 'n')
		const picked = followRoute(withNew, board('D'))
		expect(picked.splits).toEqual([{ tabs: ['a', 'n'], size: 50 }])
		expect(picked.tabs.find((tab) => tab.id === 'n')!.route).toEqual(board('D'))
		// Picking a board open in another tab closes the New tab, and its split with it.
		expect(followRoute(withNew, board('C'))).toMatchObject({ activeId: 'c', splits: [] })
	})

	it('reads saved splits, dropping the broken and keeping their tabs together', () => {
		const raw = JSON.stringify({
			tabs: [{ id: 'a', route: board('A') }, { id: 'b', route: board('B') }, { id: 'c', route: board('C') }],
			activeId: 'a',
			splits: [
				{ tabs: ['a', 'c'], size: 5 },
				{ tabs: ['c', 'b'], size: 50 },
				{ tabs: ['b', 'gone'], size: 50 },
			],
		})
		const state = parseTabs(raw)
		expect(state.splits).toEqual([{ tabs: ['a', 'c'], size: 20 }])
		expect(ids(state)).toEqual(['a', 'c', 'b'])
	})
})
