import type { Route } from './useHashRoute'

/**
 * The tab strip's tabs as plain data and pure transitions, without React or the router.
 *
 * A tab holds the route it shows: a board, the daily page (with the day it was on), or the home screen,
 * which is what a New tab shows until a board is picked in it. A board is open in at most one tab, since
 * there is one editor per board, and so is the daily page. `activeId` is the tab on screen, or `null` on
 * a page outside the strip: the pinned All Boards, Settings or Help.
 */
export type TabRoute =
	| { view: 'list' }
	| { view: 'board'; boardId: string }
	| { view: 'daily'; day?: string; review?: boolean }

export interface Tab {
	id: string
	route: TabRoute
}

export interface TabsState {
	tabs: Tab[]
	activeId: string | null
}

export const EMPTY_TABS: TabsState = { tabs: [], activeId: null }

let counter = 0
export function newTabId(): string {
	counter += 1
	return `t${Date.now().toString(36)}${counter.toString(36)}`
}

/** The route a tab keeps for `route`, or null for one that has no tab (Settings, Help). */
export function tabRouteOf(route: Route): TabRoute | null {
	if (route.view === 'board') return { view: 'board', boardId: route.boardId }
	if (route.view === 'daily') {
		const { day, review } = route
		return { view: 'daily', ...(day && { day }), ...(review && { review }) }
	}
	return null
}

/** Whether two routes are the same page for a tab: the same board, or both the daily page. */
const samePage = (a: TabRoute, b: TabRoute) =>
	a.view === 'board' ? b.view === 'board' && a.boardId === b.boardId : a.view === 'daily' && b.view === 'daily'

const sameRoute = (a: TabRoute, b: TabRoute) => JSON.stringify(a) === JSON.stringify(b)

export const activeTab = (state: TabsState): Tab | undefined => state.tabs.find((tab) => tab.id === state.activeId)

export const boardIdOf = (tab: Tab): string | null => (tab.route.view === 'board' ? tab.route.boardId : null)

export const boardIds = (state: TabsState): string[] => state.tabs.flatMap((tab) => boardIdOf(tab) ?? [])

const isTabRoute = (value: unknown): value is TabRoute => {
	const route = value as Partial<{ view: string; boardId: unknown; day: unknown; review: unknown }> | null
	if (route?.view === 'list') return true
	if (route?.view === 'board') return typeof route.boardId === 'string'
	if (route?.view === 'daily') {
		return (route.day === undefined || typeof route.day === 'string') && (route.review === undefined || route.review === true)
	}
	return false
}

/**
 * Reads saved tabs, dropping what doesn't hold together. An older version saved a list of board ids,
 * with `'daily'` for the daily page; that is read as tabs with nothing active.
 */
export function parseTabs(raw: string | null): TabsState {
	try {
		const saved: unknown = JSON.parse(raw ?? 'null')
		if (Array.isArray(saved)) {
			const ids = saved.filter((id): id is string => typeof id === 'string')
			return dedupe({
				tabs: ids.map((id) => ({
					id: newTabId(),
					route: id === 'daily' ? { view: 'daily' } : { view: 'board', boardId: id },
				})),
				activeId: null,
			})
		}
		const state = saved as Partial<TabsState> | null
		if (!Array.isArray(state?.tabs)) return EMPTY_TABS
		const tabs = state.tabs.filter(
			(tab): tab is Tab => typeof (tab as Partial<Tab> | null)?.id === 'string' && isTabRoute((tab as Tab).route)
		)
		const activeId = tabs.some((tab) => tab.id === state.activeId) ? (state.activeId as string) : null
		return dedupe({ tabs, activeId })
	} catch {
		return EMPTY_TABS
	}
}

/** Keeps the first tab of each board and of the daily page. */
function dedupe(state: TabsState): TabsState {
	const tabs = state.tabs.filter(
		(tab, i) => tab.route.view === 'list' || state.tabs.findIndex((other) => samePage(other.route, tab.route)) === i
	)
	return tabs.length === state.tabs.length ? state : { tabs, activeId: tabs.some((t) => t.id === state.activeId) ? state.activeId : null }
}

export function activateTab(state: TabsState, id: string | null): TabsState {
	if (state.activeId === id || (id !== null && !state.tabs.some((tab) => tab.id === id))) return state
	return { ...state, activeId: id }
}

const setRoute = (state: TabsState, id: string, route: TabRoute): TabsState => ({
	...state,
	tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, route } : tab)),
})

/**
 * Opens a tab on `route` at the end of the row, or shows the one already open on that page. A background
 * open leaves the active tab as it is.
 */
export function openTab(state: TabsState, route: TabRoute, { background = false, id = newTabId() } = {}): TabsState {
	const open = route.view === 'list' ? undefined : state.tabs.find((tab) => samePage(tab.route, route))
	if (open) return background ? state : activateTab(state, open.id)
	const tabs = [...state.tabs, { id, route }]
	return { tabs, activeId: background ? state.activeId : id }
}

/**
 * The tabs after the app moved to `route`, by whatever way: a tab's click, a link, back and forward.
 *
 * - A board or the daily page becomes the active tab. In a New tab, the page opens in that tab, unless it
 *   is already open in another, which is then shown and the New tab closed.
 * - The home screen keeps a New tab active, if one is; otherwise it is the pinned All Boards, and so are
 *   Settings and Help: no tab is active.
 */
export function followRoute(state: TabsState, route: Route): TabsState {
	const target = tabRouteOf(route)
	const active = activeTab(state)
	if (!target) {
		if (route.view === 'list' && active?.route.view === 'list') return state
		return activateTab(state, null)
	}
	const open = state.tabs.find((tab) => samePage(tab.route, target))
	if (active?.route.view === 'list') {
		if (!open) return setRoute(state, active.id, target)
		const tabs = state.tabs.filter((tab) => tab.id !== active.id)
		return setRoute({ tabs, activeId: open.id }, open.id, target)
	}
	if (!open) return openTab(state, target)
	const shown = activateTab(state, open.id)
	return sameRoute(open.route, target) ? shown : setRoute(shown, open.id, target)
}

/**
 * Closes tabs. A closed active tab hands over to the tab that took its place in the row, else the one
 * before it; with none left, nothing is active.
 */
export function closeTabs(state: TabsState, ids: readonly string[]): TabsState {
	const closing = new Set(ids)
	if (!state.tabs.some((tab) => closing.has(tab.id))) return state
	const tabs = state.tabs.filter((tab) => !closing.has(tab.id))
	let { activeId } = state
	if (activeId !== null && closing.has(activeId)) {
		const index = state.tabs.findIndex((tab) => tab.id === activeId)
		const after = state.tabs.slice(index).find((tab) => !closing.has(tab.id))
		const before = state.tabs
			.slice(0, index)
			.reverse()
			.find((tab) => !closing.has(tab.id))
		activeId = (after ?? before)?.id ?? null
	}
	return { tabs, activeId }
}

/** The ids "Close other tabs" closes. */
export const otherTabIds = (state: TabsState, id: string) => state.tabs.filter((tab) => tab.id !== id).map((tab) => tab.id)

/** The ids "Close tabs to the right" closes. */
export const tabIdsAfter = (state: TabsState, id: string) =>
	state.tabs.slice(state.tabs.findIndex((tab) => tab.id === id) + 1).map((tab) => tab.id)

/** Moves a tab to `toIndex` of the row, counted with it still in place. */
export function moveTab(state: TabsState, id: string, toIndex: number): TabsState {
	const from = state.tabs.findIndex((tab) => tab.id === id)
	const to = Math.max(0, Math.min(state.tabs.length - 1, toIndex))
	if (from < 0 || from === to) return state
	const tabs = [...state.tabs]
	const [tab] = tabs.splice(from, 1)
	tabs.splice(to, 0, tab!)
	return { ...state, tabs }
}

/** The tab `step` places along from the active one, wrapping; the first or last when none is active. */
export function tabAlong(state: TabsState, step: number): Tab | undefined {
	const count = state.tabs.length
	if (count === 0) return undefined
	const index = state.tabs.findIndex((tab) => tab.id === state.activeId)
	if (index < 0) return state.tabs[step > 0 ? 0 : count - 1]
	return state.tabs[(((index + step) % count) + count) % count]
}

/** Drops the tabs of boards that are not in `known`. A dropped active tab leaves none active. */
export const dropUnknownBoards = (state: TabsState, known: ReadonlySet<string>): TabsState =>
	dropTabs(state, (id) => !known.has(id))

/** Drops the tab of a board that was deleted, leaving none active if it was. */
export const withoutBoard = (state: TabsState, boardId: string): TabsState => dropTabs(state, (id) => id === boardId)

function dropTabs(state: TabsState, drop: (boardId: string) => boolean): TabsState {
	const gone = state.tabs.filter((tab) => {
		const id = boardIdOf(tab)
		return id !== null && drop(id)
	})
	if (gone.length === 0) return state
	const tabs = state.tabs.filter((tab) => !gone.includes(tab))
	return { tabs, activeId: tabs.some((tab) => tab.id === state.activeId) ? state.activeId : null }
}

/** Most recently shown first, with `id` moved to the front. */
export const touchRecent = (recent: readonly string[], id: string): string[] => [id, ...recent.filter((one) => one !== id)]

/** Whether a click opens its board in a tab behind this one: ⌘ or Ctrl held, or the middle button. */
export const opensBehind = (click: { metaKey: boolean; ctrlKey: boolean; button: number }) =>
	click.metaKey || click.ctrlKey || click.button === 1
