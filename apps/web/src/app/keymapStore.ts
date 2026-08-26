import { getUserBindings, setUserBindings, type UserBindings } from '@lifeboard/node-kit'

/**
 * The user's keymap, kept across reloads — app-wide like every other preference (see
 * `canvasPrefs.tsx` for the pattern and the localStorage rationale).
 *
 * Stored as *only what they changed*, not the whole keymap. An extension installed later, or a
 * default we improve in a release, then reaches them; a snapshot of every binding would freeze the
 * table as it was on the day they first opened Settings → Keyboard.
 */
const KEYMAP_KEY = 'lifeboard:keymap'

/** Loaded synchronously from the composition root, so the first keypress already respects it. */
export function loadUserBindings(): void {
	try {
		const raw = localStorage.getItem(KEYMAP_KEY)
		const parsed: unknown = raw ? JSON.parse(raw) : null
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
		const bindings: Record<string, string | null> = {}
		for (const [id, chord] of Object.entries(parsed as Record<string, unknown>)) {
			// `null` is a real value here — "unbound" — so it is kept, and anything else malformed is
			// dropped rather than allowed to make one bad entry cost the whole keymap.
			if (chord === null || typeof chord === 'string') bindings[id] = chord
		}
		setUserBindings(bindings)
	} catch {
		// Also the node path: vitest imports the composition root for its registrations, with no DOM.
	}
}

function persist(bindings: UserBindings): void {
	try {
		localStorage.setItem(KEYMAP_KEY, JSON.stringify(bindings))
	} catch {
		// Private-mode Safari can throw on write; losing the preference across reloads is fine.
	}
}

/** Binds a command to a chord, or to nothing at all when `chord` is `null`. */
export function bindCommand(commandId: string, chord: string | null): void {
	const next = { ...getUserBindings(), [commandId]: chord }
	setUserBindings(next)
	persist(next)
}

/** Gives a command its default back — *removing* the entry, rather than writing the default in. */
export function resetCommandBinding(commandId: string): void {
	const next = { ...getUserBindings() }
	delete next[commandId]
	setUserBindings(next)
	persist(next)
}

export function resetAllBindings(): void {
	setUserBindings({})
	persist({})
}
