import { useEffect, useState } from 'react'
import type { BoardMeta } from '../boards/boardIndex'
import { dropUnknownBoards, parseTabs, type TabsState } from './tabsModel'

/**
 * The tab strip's tabs (`tabsModel.ts`).
 *
 * Session-scoped on purpose: tabs are "what I'm working on right now", so they survive a reload but
 * not a new visit, and each window keeps its own, as a browser's tabs do. Board *data* never lives
 * here, only ids; the strip resolves names against the live index so renames show up immediately.
 */
const TABS_KEY = 'lifeboard:openTabs'

/** The daily page's entry in the phone's board pill, which lists board ids and this. */
export const DAILY_TAB = 'daily'

export function useTabs(boards: BoardMeta[], boardsLoading: boolean) {
	const [state, setState] = useState<TabsState>(() => {
		try {
			return parseTabs(sessionStorage.getItem(TABS_KEY))
		} catch {
			return parseTabs(null)
		}
	})

	useEffect(() => {
		try {
			sessionStorage.setItem(TABS_KEY, JSON.stringify(state))
		} catch {
			// Private-mode Safari can throw on write; losing tab restoration is fine.
		}
	}, [state])

	// Drop tabs for boards that no longer exist — but only once the index has actually loaded,
	// otherwise the initial empty list would wipe every restored tab on startup.
	useEffect(() => {
		if (boardsLoading) return
		const known = new Set(boards.map((b) => b.id))
		setState((current) => dropUnknownBoards(current, known))
	}, [boards, boardsLoading])

	return [state, setState] as const
}
