import { useCallback, useEffect, useState } from 'react'

/**
 * A hash router in ~40 lines, which is the plan's stated alternative to pulling in React Router for
 * a two-screen app (§3). Hash routing also means the built app works from `file://` and from any
 * subpath without server rewrites — useful under Tauri later.
 */
export type Route =
	| { view: 'list' }
	/**
	 * `tab` is the settings page's inner sidebar selection (`#/settings/extensions`), and
	 * `extensionId` the extension whose own page is open beneath the Extensions tab
	 * (`#/settings/extensions/lifeboard.book-reader`).
	 *
	 * Routed for the same reasons as the help sections, plus one the extensions list adds: an
	 * extension's page is a thing to link to. "Here's the books extension" has to survive being pasted
	 * into a message, which is the whole point of a list that will one day hold other people's work.
	 */
	| { view: 'settings'; tab?: string; extensionId?: string }
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
	// Validated by the settings page against its own tab list, like the help sections below. The
	// extension id is deliberately loose — dots are what makes `lifeboard.book-reader` a namespaced id,
	// and a third-party one will look the same.
	const settings = /^#\/settings\/([a-z-]+)(?:\/([\w.-]+))?$/.exec(hash)
	if (settings) {
		const tab = settings[1]!
		const extensionId = settings[2]
		return extensionId ? { view: 'settings', tab, extensionId } : { view: 'settings', tab }
	}
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
	if (route.view === 'settings') {
		if (!route.tab) return '#/settings'
		return route.extensionId
			? `#/settings/${route.tab}/${route.extensionId}`
			: `#/settings/${route.tab}`
	}
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
