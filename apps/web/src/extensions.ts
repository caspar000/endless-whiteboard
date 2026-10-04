import { bookReaderExtension } from '@lifeboard/book-reader'
import { diceExtension } from '@lifeboard/dice'
import {
	getDisabledExtensionIds,
	registerCoreOperations,
	registerExtension,
	setDisabledExtensionIds,
	tablesExtension,
} from '@lifeboard/node-kit'
import { markdownNoteExtension } from '@lifeboard/note-markdown'
// Imported for its side effect: installs the app's `BoardBridge` at module scope, which the
// operations registered below cannot run without.
import './agent/boardBridge'
import { registerOperationCommands } from './app/operationCommands'
import { loadUserBindings } from './app/keymapStore'
import { loadSavedQueries } from './app/savedQueries'
import { registerNodeCommands } from './canvas/insertNode'
import { registerToolCommands } from './canvas/toolCommands'

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
registerExtension(bookReaderExtension)
// Contributes no node types — only canvas chrome, commands and an operation. Registered here all the
// same: the composition root is the list of what this build ships, not the list of what has shapes.
registerExtension(diceExtension)

// Projects the now-complete node registry onto the command table ("Add note", "Add table", …).
// After the registrations above, deliberately: it reads what they just put there.
registerNodeCommands()

// ...and the dock's tools onto it too, so a tool key is a binding the user can move rather than
// something only tldraw knows about. After the node registrations, for the same reason.
registerToolCommands()

/*
 * The agent operation surface. After the board bridge is installed (the import above) and after the
 * extensions, so `node.insert` can offer every registered type.
 *
 * Registering them is not the same as exposing them: nothing can call an operation until the bridge
 * in Settings → Agents is switched on. This only means the table is populated if it is.
 */
registerCoreOperations()

// ...and the handful of them a person should also be able to reach by name. After the line above,
// which is what puts the rows in the table this reads.
registerOperationCommands()

/*
 * The questions the user has named, back into the expression vocabulary.
 *
 * After the extensions, deliberately: `registerQuery` replaces by name, so loading these last is
 * what makes a name someone chose for themselves win over one a plugin shipped with.
 */
loadSavedQueries()

/*
 * The user's keymap, over the defaults the table declares.
 *
 * Last of all, because it is a view of the finished command table: loading it earlier would work
 * (bindings are matched by id, not by resolving a command) but reads as though order did not matter.
 */
loadUserBindings()

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
