import { useCallback, useEffect, useState } from 'react'
import type { BoardMeta } from '../boards/boardIndex'

/**
 * The open-board tabs shown in the shell's tab strip.
 *
 * Session-scoped on purpose: tabs are "what I'm working on right now", so they survive a reload but
 * not a new visit — the same policy every browser applies to its own tabs. Board *data* never lives
 * here, only ids; the strip resolves names against the live index so renames show up immediately.
 */
const TABS_KEY = 'lifeboard:openTabs'

function loadTabs(): string[] {
	try {
		const raw = sessionStorage.getItem(TABS_KEY)
		const parsed: unknown = raw ? JSON.parse(raw) : []
		return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
	} catch {
		return []
	}
}

export function useTabs(boards: BoardMeta[], boardsLoading: boolean) {
	const [tabs, setTabs] = useState<string[]>(loadTabs)

	useEffect(() => {
		try {
			sessionStorage.setItem(TABS_KEY, JSON.stringify(tabs))
		} catch {
			// Private-mode Safari can throw on write; losing tab restoration is fine.
		}
	}, [tabs])

	// Drop tabs for boards that no longer exist — but only once the index has actually loaded,
	// otherwise the initial empty list would wipe every restored tab on startup.
	useEffect(() => {
		if (boardsLoading) return
		const known = new Set(boards.map((b) => b.id))
		setTabs((current) => {
			const kept = current.filter((id) => known.has(id))
			return kept.length === current.length ? current : kept
		})
	}, [boards, boardsLoading])

	const openTab = useCallback((id: string) => {
		setTabs((current) => (current.includes(id) ? current : [...current, id]))
	}, [])

	const closeTab = useCallback((id: string) => {
		setTabs((current) => current.filter((t) => t !== id))
	}, [])

	return { tabs, openTab, closeTab }
}
