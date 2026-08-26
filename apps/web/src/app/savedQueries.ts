import { forgetQuery, getUserQueries, registerQuery, type NamedQuery } from '@lifeboard/node-kit'

/**
 * The questions the user named, kept across reloads.
 *
 * App-wide rather than per-board, like every other preference (see `canvasPrefs.tsx` for the pattern
 * and the localStorage rationale) — and right here, because a shorthand you invented for one board
 * is usually a way of thinking you carry to the next one. A query that only worked where it was
 * written would be a note, not a word.
 *
 * Stored as the whole list rather than a diff: there is no default set to diff against, and a few
 * dozen `{name, body}` pairs is a rounding error next to a single board's canvas.
 */
const QUERIES_KEY = 'lifeboard:queries'

function isNamedQuery(value: unknown): value is NamedQuery {
	if (!value || typeof value !== 'object') return false
	const query = value as Partial<NamedQuery>
	return typeof query.name === 'string' && typeof query.body === 'string'
}

/**
 * Loads them into the registry. Called from the composition root **after** the extensions, which is
 * what makes a name the user chose beat one that arrived with a plugin (`registerQuery` replaces).
 */
export function loadSavedQueries(): void {
	try {
		const raw = localStorage.getItem(QUERIES_KEY)
		const parsed: unknown = raw ? JSON.parse(raw) : []
		if (!Array.isArray(parsed)) return
		// Defensive like the board index's own filter: this survives app upgrades and hand-edited
		// backups, and one malformed entry must not cost the rest.
		for (const query of parsed.filter(isNamedQuery)) registerQuery(query)
	} catch {
		// Also the node path: vitest imports the composition root for its registrations, with no DOM.
	}
}

function persist(): void {
	try {
		localStorage.setItem(QUERIES_KEY, JSON.stringify(getUserQueries()))
	} catch {
		// Private-mode Safari can throw on write; losing the preference across reloads is fine.
	}
}

/** Registers and remembers, or returns `false` if the registry refused the name. */
export function saveQuery(query: NamedQuery): boolean {
	if (!registerQuery(query)) return false
	persist()
	return true
}

export function forgetSavedQuery(name: string): void {
	forgetQuery(name)
	persist()
}
