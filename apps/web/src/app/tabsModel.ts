import type { Route } from './useHashRoute'

/**
 * The tab strip's tabs as plain data and pure transitions, without React or the router.
 *
 * A tab holds the route it shows: a board, the daily page (with the day it was on), or the home screen,
 * which is what a New tab shows until a board is picked in it. A board is open in at most one tab, since
 * there is one editor per board, and so is the daily page. `activeId` is the tab on screen, or `null` on
 * a page outside the strip: the pinned All Boards, Settings or Help.
 *
 * A split shows several tabs at once, as oritask's do (after Zen): its first tab in the left column,
 * the others stacked in the right one, `size` being the left column's share of the width in percent.
 * Its tabs sit together in the row, and the active tab is the focused pane.
 */
export type TabRoute =
	| { view: 'list' }
	| { view: 'board'; boardId: string }
	| { view: 'daily'; day?: string; review?: boolean }

export interface Tab {
	id: string
	route: TabRoute
}

export interface TabSplit {
	tabs: string[]
	size: number
}

export interface TabsState {
	tabs: Tab[]
	activeId: string | null
	splits: TabSplit[]
}

export const EMPTY_TABS: TabsState = { tabs: [], activeId: null, splits: [] }

/** The narrowest a column of a split may be, in percent of the width. */
export const MIN_SPLIT_SIZE = 20

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

export const splitOf = (state: TabsState, id: string | null): TabSplit | undefined =>
	id === null ? undefined : state.splits.find((split) => split.tabs.includes(id))

/** The tabs on screen: every tab of the active one's split, or the active tab, or none. */
export function visibleTabs(state: TabsState): Tab[] {
	const ids = splitOf(state, state.activeId)?.tabs ?? (state.activeId ? [state.activeId] : [])
	return ids.flatMap((id) => state.tabs.find((tab) => tab.id === id) ?? [])
}

const isTabRoute = (value: unknown): value is TabRoute => {
	const route = value as Partial<{ view: string; boardId: unknown; day: unknown; review: unknown }> | null
	if (route?.view === 'list') return true
	if (route?.view === 'board') return typeof route.boardId === 'string'
	if (route?.view === 'daily') {
		return (route.day === undefined || typeof route.day === 'string') && (route.review === undefined || route.review === true)
	}
	return false
}

const clampSize = (size: number) => Math.min(100 - MIN_SPLIT_SIZE, Math.max(MIN_SPLIT_SIZE, size))

/**
 * Reads saved tabs, dropping what doesn't hold together. An older version saved a list of board ids,
 * with `'daily'` for the daily page; that is read as tabs with nothing active.
 */
export function parseTabs(raw: string | null): TabsState {
	try {
		const saved: unknown = JSON.parse(raw ?? 'null')
		if (Array.isArray(saved)) {
			const ids = saved.filter((id): id is string => typeof id === 'string')
			return tidy({
				tabs: ids.map((id) => ({
					id: newTabId(),
					route: id === 'daily' ? { view: 'daily' } : { view: 'board', boardId: id },
				})),
				activeId: null,
				splits: [],
			})
		}
		const state = saved as Partial<TabsState> | null
		if (!Array.isArray(state?.tabs)) return EMPTY_TABS
		const tabs = state.tabs
			.filter((tab): tab is Tab => typeof (tab as Partial<Tab> | null)?.id === 'string' && isTabRoute((tab as Tab).route))
			.map(({ id, route }) => ({ id, route }))
		const splits = (Array.isArray(state.splits) ? state.splits : []).map((split) => ({
			tabs: Array.isArray(split?.tabs) ? split.tabs.filter((id): id is string => typeof id === 'string') : [],
			size: clampSize(Number(split?.size) || 50),
		}))
		const activeId = tabs.some((tab) => tab.id === state.activeId) ? (state.activeId as string) : null
		return tidy({ tabs, activeId, splits })
	} catch {
		return EMPTY_TABS
	}
}

/**
 * What every saved state must be: one tab per board and per daily page, each tab in one split at most,
 * splits of two or more tabs that are open, and each split's tabs together in the row, in its order.
 */
function tidy(state: TabsState): TabsState {
	const tabs = state.tabs.filter(
		(tab, i) => tab.route.view === 'list' || state.tabs.findIndex((other) => samePage(other.route, tab.route)) === i
	)
	const open = new Set(tabs.map((tab) => tab.id))
	const taken = new Set<string>()
	const splits: TabSplit[] = []
	for (const split of state.splits) {
		const ids = [...new Set(split.tabs)].filter((id) => open.has(id) && !taken.has(id))
		if (ids.length < 2) continue
		ids.forEach((id) => taken.add(id))
		splits.push({ tabs: ids, size: split.size })
	}
	const tidied = { tabs, activeId: open.has(state.activeId ?? '') ? state.activeId : null, splits }
	return splits.reduce((acc, split) => placeTogether(acc, split.tabs), tidied)
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
	return { ...state, tabs, activeId: background ? state.activeId : id }
}

/**
 * The tabs after the app moved to `route`, by whatever way: a tab's click, a link, back and forward.
 *
 * - A board or the daily page becomes the active tab. In a New tab, the page opens in that tab (in its
 *   split's pane), unless it is already open in another, which is then shown and the New tab closed.
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
		const closed = { ...closeTabs(state, [active.id]), activeId: open.id }
		return setRoute(closed, open.id, target)
	}
	if (!open) return openTab(state, target)
	const shown = activateTab(state, open.id)
	return sameRoute(open.route, target) ? shown : setRoute(shown, open.id, target)
}

/** Takes tabs out of their splits; a split left with one tab ends. */
function withoutTabs(splits: TabSplit[], ids: ReadonlySet<string>): TabSplit[] {
	const kept = splits
		.map((split) => ({ ...split, tabs: split.tabs.filter((id) => !ids.has(id)) }))
		.filter((split) => split.tabs.length >= 2)
	return kept.length === splits.length && kept.every((split, i) => split.tabs.length === splits[i]!.tabs.length) ? splits : kept
}

/**
 * Closes tabs. A closed active tab hands over to another pane of its split, else to the tab that took
 * its place in the row, else the one before it; with none left, nothing is active.
 */
export function closeTabs(state: TabsState, ids: readonly string[]): TabsState {
	const closing = new Set(ids)
	if (!state.tabs.some((tab) => closing.has(tab.id))) return state
	const tabs = state.tabs.filter((tab) => !closing.has(tab.id))
	let { activeId } = state
	if (activeId !== null && closing.has(activeId)) {
		const partner = splitOf(state, activeId)?.tabs.find((id) => !closing.has(id))
		const index = state.tabs.findIndex((tab) => tab.id === activeId)
		const after = state.tabs.slice(index).find((tab) => !closing.has(tab.id))
		const before = state.tabs
			.slice(0, index)
			.reverse()
			.find((tab) => !closing.has(tab.id))
		activeId = partner ?? (after ?? before)?.id ?? null
	}
	return { tabs, activeId, splits: withoutTabs(state.splits, closing) }
}

/** The ids "Close other tabs" closes. */
export const otherTabIds = (state: TabsState, id: string) => state.tabs.filter((tab) => tab.id !== id).map((tab) => tab.id)

/** The ids "Close tabs to the right" closes: past the label `id` is in, a split's being one label. */
export function tabIdsAfter(state: TabsState, id: string): string[] {
	const block = blockOf(state, id)
	const last = Math.max(...block.map((tab) => state.tabs.indexOf(tab)))
	return state.tabs.slice(last + 1).map((tab) => tab.id)
}

/** One label of the row: a tab's, or a split's, which holds its tabs in their split order. */
export type RowEntry = { kind: 'tab'; tab: Tab } | { kind: 'split'; split: TabSplit; tabs: Tab[] }

export function rowEntries(state: TabsState): RowEntry[] {
	const entries: RowEntry[] = []
	for (const tab of state.tabs) {
		const split = splitOf(state, tab.id)
		if (!split) entries.push({ kind: 'tab', tab })
		else if (split.tabs[0] === tab.id || !state.tabs.some((one) => one.id === split.tabs[0])) {
			entries.push({ kind: 'split', split, tabs: split.tabs.flatMap((id) => state.tabs.find((one) => one.id === id) ?? []) })
		}
	}
	return entries
}

/** The tabs that move together in the row: a split's, in its order, or the one tab. */
function blockOf(state: TabsState, id: string): Tab[] {
	const ids = splitOf(state, id)?.tabs ?? [id]
	return ids.flatMap((one) => state.tabs.find((tab) => tab.id === one) ?? [])
}

/** Moves a tab, with the rest of its split, to `toIndex` of the row's labels (`rowEntries`), counted without it. */
export function moveTab(state: TabsState, id: string, toIndex: number): TabsState {
	const moving = blockOf(state, id)
	if (moving.length === 0) return state
	const rest = { ...state, tabs: state.tabs.filter((tab) => !moving.includes(tab)) }
	const before = rowEntries(rest)[toIndex - 1]
	const lastBefore = before?.kind === 'tab' ? before.tab : before?.tabs.at(-1)
	const at = lastBefore ? rest.tabs.indexOf(lastBefore) + 1 : 0
	const tabs = [...rest.tabs.slice(0, at), ...moving, ...rest.tabs.slice(at)]
	return tabs.every((tab, i) => tab === state.tabs[i]) ? state : { ...state, tabs }
}

/** Puts tabs together in the row, in this order, where the first of them is. */
function placeTogether(state: TabsState, ids: readonly string[]): TabsState {
	const members = ids.flatMap((id) => state.tabs.find((tab) => tab.id === id) ?? [])
	const first = state.tabs.findIndex((tab) => tab === members[0])
	const before = state.tabs.slice(0, first).filter((tab) => !members.includes(tab))
	const after = state.tabs.slice(first).filter((tab) => !members.includes(tab))
	const tabs = [...before, ...members, ...after]
	return tabs.every((tab, i) => tab === state.tabs[i]) ? state : { ...state, tabs }
}

/** Shows `right` beside `left`, each leaving the split it was in, and focuses `left`. */
export function splitTabs(state: TabsState, left: string, right: string): TabsState {
	const ids = new Set(state.tabs.map((tab) => tab.id))
	if (left === right || !ids.has(left) || !ids.has(right)) return state
	const splits = [...withoutTabs(state.splits, new Set([left, right])), { tabs: [left, right], size: 50 }]
	return placeTogether({ ...state, activeId: left, splits }, [left, right])
}

/**
 * Shows `route` beside tab `besideId`: in a new split, or at the bottom of the right column of the split
 * `besideId` is in. The tab already open on that page is shown there rather than a second one, and the
 * new pane is focused.
 */
export function openBeside(state: TabsState, besideId: string, route: TabRoute, id = newTabId()): TabsState {
	if (!state.tabs.some((tab) => tab.id === besideId)) return state
	const open = route.view === 'list' ? undefined : state.tabs.find((tab) => samePage(tab.route, route))
	if (open?.id === besideId) return activateTab(state, besideId)
	const paneId = open?.id ?? id
	const withTab = open ? state : { ...state, tabs: [...state.tabs, { id: paneId, route }] }
	const split = splitOf(withTab, besideId)
	if (!split) return { ...splitTabs(withTab, besideId, paneId), activeId: paneId }
	if (split.tabs.includes(paneId)) return activateTab(withTab, paneId)
	const grown = { ...split, tabs: [...split.tabs, paneId] }
	const splits = [...withoutTabs(withTab.splits.filter((one) => one !== split), new Set([paneId])), grown]
	return placeTogether({ ...withTab, splits, activeId: paneId }, grown.tabs)
}

/** Ends the split `id` is in; its tabs stay, side by side in the row. */
export const unsplit = (state: TabsState, id: string): TabsState => {
	const splits = state.splits.filter((split) => !split.tabs.includes(id))
	return splits.length === state.splits.length ? state : { ...state, splits }
}

/** Sets the share of the width the left column of `leftId`'s split takes. */
export const resizeSplit = (state: TabsState, leftId: string, size: number): TabsState => ({
	...state,
	splits: state.splits.map((split) => (split.tabs[0] === leftId ? { ...split, size: clampSize(size) } : split)),
})

/** Where each pane of a split sits, in percent of the split's area. */
export interface PaneRect {
	left: number
	width: number
	top: number
	height: number
}

/** The left column for the split's first tab, and equal rows of the right one for the others. */
export function paneRects(split: TabSplit, size = split.size): Map<string, PaneRect> {
	const [left, ...rows] = split.tabs
	const rects = new Map<string, PaneRect>()
	rects.set(left!, { left: 0, width: size, top: 0, height: 100 })
	rows.forEach((id, i) => rects.set(id, { left: size, width: 100 - size, top: (i * 100) / rows.length, height: 100 / rows.length }))
	return rects
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
	return {
		tabs,
		activeId: tabs.some((tab) => tab.id === state.activeId) ? state.activeId : null,
		splits: withoutTabs(state.splits, new Set(gone.map((tab) => tab.id))),
	}
}

/** Most recently shown first, with `id` moved to the front. */
export const touchRecent = (recent: readonly string[], id: string): string[] => [id, ...recent.filter((one) => one !== id)]

/** Where a click on a board opens it: in place, in a tab behind this one, or beside it in a split. */
export type OpenMode = 'here' | 'behind' | 'beside'

/** ⌥ opens beside, as oritask's "open beside"; ⌘, Ctrl or the middle button behind, as in a browser. */
export const openModeOf = (click: { altKey: boolean; metaKey: boolean; ctrlKey: boolean; button: number }): OpenMode =>
	click.altKey ? 'beside' : click.metaKey || click.ctrlKey || click.button === 1 ? 'behind' : 'here'
