import { useCallback, useEffect, useState } from 'react'

/**
 * A hash router in ~40 lines, which is the plan's stated alternative to pulling in React Router for
 * a two-screen app (§3). Hash routing also means the built app works from `file://` and from any
 * subpath without server rewrites — useful under Tauri later.
 */
export type Route =
	| { view: 'list' }
	| { view: 'settings' }
	/**
	 * `section` is the help page's inner sidebar selection (`#/help/properties`).
	 *
	 * In the route rather than in component state so a section is a **link**: "read the Properties page"
	 * is a thing worth being able to send someone, and going back after clicking a cross-reference
	 * should return you to where you were. Optional, because `#/help` is the overview — and because
	 * every existing `#/help` link has to keep working.
	 */
	| { view: 'help'; section?: string }
	| { view: 'board'; boardId: string; seedDemo?: boolean }

function parseHash(hash: string): Route {
	if (hash === '#/settings') return { view: 'settings' }
	if (hash === '#/help') return { view: 'help' }
	// Validated by the help page against its own section list, not here: the router has no business
	// knowing what the sections are, and an unknown one simply falls back to the overview.
	const help = /^#\/help\/([a-z-]+)$/.exec(hash)
	if (help) return { view: 'help', section: help[1]! }
	const match = /^#\/board\/([^?]+)(\?.*)?$/.exec(hash)
	if (!match) return { view: 'list' }
	const boardId = decodeURIComponent(match[1]!)
	const seedDemo = new URLSearchParams(match[2] ?? '').get('demo') === '1'
	return seedDemo ? { view: 'board', boardId, seedDemo } : { view: 'board', boardId }
}

function toHash(route: Route): string {
	if (route.view === 'list') return '#/'
	if (route.view === 'settings') return '#/settings'
	if (route.view === 'help') return route.section ? `#/help/${route.section}` : '#/help'
	const suffix = route.seedDemo ? '?demo=1' : ''
	return `#/board/${encodeURIComponent(route.boardId)}${suffix}`
}

export function useHashRoute(): [Route, (route: Route) => void] {
	const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))

	useEffect(() => {
		const onChange = () => setRoute(parseHash(window.location.hash))
		window.addEventListener('hashchange', onChange)
		return () => window.removeEventListener('hashchange', onChange)
	}, [])

	const navigate = useCallback((next: Route) => {
		const hash = toHash(next)
		if (window.location.hash === hash) {
			// Same hash → no `hashchange` event, so update state directly or the UI would not move.
			setRoute(next)
			return
		}
		window.location.hash = hash
	}, [])

	return [route, navigate]
}
