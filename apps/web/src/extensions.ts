import {
	getDisabledExtensionIds,
	registerExtension,
	setDisabledExtensionIds,
	tablesExtension,
} from '@lifeboard/node-kit'
import { markdownNoteExtension } from '@lifeboard/note-markdown'
import { registerNodeCommands } from './canvas/insertNode'

/**
 * The composition root: the one place that decides which extensions this build of the app ships.
 * A new extension — first-party or, later, a plugin loader's — is one `registerExtension` line here.
 *
 * Runs at module scope on purpose. Consumers read the registry at *their* module scope (Board.tsx
 * builds its shape utils and tools there), so this module must be evaluated first — which Board.tsx
 * guarantees by importing it before anything that touches the registry. Registration is idempotent,
 * so a second evaluation (HMR, a test importing this alongside Board) is harmless.
 */
registerExtension(markdownNoteExtension)
registerExtension(tablesExtension)

// Projects the now-complete node registry onto the command table ("Add note", "Add table", …).
// After the registrations above, deliberately: it reads what they just put there.
registerNodeCommands()

/**
 * Which extensions the user has switched off — app-wide, like every other preference (see
 * canvasPrefs.ts for the pattern and the localStorage rationale). Loaded synchronously here so the
 * first render already reflects it; no flash of a toolbar that is about to lose a button.
 *
 * Stored as the disabled set: an extension nobody ever touched has no record and defaults to on.
 */
const DISABLED_KEY = 'lifeboard:disabledExtensions'

function loadDisabledExtensions(): string[] {
	try {
		const raw = localStorage.getItem(DISABLED_KEY)
		const parsed: unknown = raw ? JSON.parse(raw) : []
		return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
	} catch {
		// Also the node path: vitest imports this module for the registrations, without a DOM.
		return []
	}
}

export function persistDisabledExtensions(): void {
	try {
		localStorage.setItem(DISABLED_KEY, JSON.stringify(getDisabledExtensionIds()))
	} catch {
		// Private-mode Safari can throw on write; losing the preference across reloads is fine.
	}
}

setDisabledExtensionIds(loadDisabledExtensions())
