import type { Editor, TLShape } from 'tldraw'
import { readShapeProperties } from './properties/values'
import type { PropertyValue } from './properties/types'
import { isExtensionEnabled } from './registry'

/**
 * Hooks — what turns "extensions that add node types" into "extensions that add *behaviour*".
 *
 * Everything an extension could contribute until now was a thing the user reaches for: a node, a
 * command, an operation, a verb on a menu. These are the other half: something that happens *because*
 * the board changed. Auto-tagging, templates, stamping a date on what you just made.
 *
 * Three deliberate shapes to this, all of them about being unable to do damage:
 *
 * - **Reactions cannot claim.** Every enabled hook runs; none of them can stop another or take
 *   ownership of the event. That is what tells them apart from `fileImports`/`contentImports`, where
 *   exactly one extension gets the content — the issue this came from listed `onDrop` alongside these
 *   three, and it is not the same contract, so it lives next door as `ContentImport` instead.
 * - **Reactions are synchronous.** They run inside the store change that triggered them, which is
 *   what puts a hook's write in the *same* undo entry as the change — ⌘Z after creating an
 *   auto-tagged note takes back the note and its tag together. An auto-tag needing its own ⌘Z is a
 *   worse feature than no auto-tag. A hook that must await something schedules that itself and
 *   accepts that the later write is its own entry.
 * - **One extension's bad hook cannot take the board down.** Every call is wrapped; a throw is
 *   logged and the next hook runs.
 */

export interface BoardOpenContext {
	editor: Editor
	boardId: string
}

export interface ShapeCreateContext {
	editor: Editor
	shape: TLShape
}

export interface PropertyChangeContext {
	editor: Editor
	shape: TLShape
	propertyId: string
	/** `null` when the property was not carried before — which is what an attach looks like. */
	before: PropertyValue | null
	after: PropertyValue | null
}

export interface BoardHooks {
	/** A board's editor has mounted and its content is loaded. */
	onBoardOpen?(ctx: BoardOpenContext): void
	/**
	 * A shape was created by the user — through any door: the dock, the palette, a paste, a
	 * duplicate, an import, an agent operation.
	 *
	 * *Shape*, not node, and the name is the honest one: universal properties mean the facts pipeline
	 * already walks every shape on the board rather than only the registered types, so a sticky and a
	 * photo are as taggable as a note. A hook that only cares about node types asks
	 * `getNodeDefinition(shape.type)`.
	 */
	onShapeCreate?(ctx: ShapeCreateContext): void
	/** One property's value changed on one shape. Fired once per changed property. */
	onPropertyChange?(ctx: PropertyChangeContext): void
}

export interface HookSet extends BoardHooks {
	/**
	 * Namespaced and stable, like a command id. Re-registration by id **replaces**, for the reason
	 * `registerCommand` does: under HMR the defining module re-evaluates with fresh closures while
	 * this registry persists, and keeping the stale entry would run dead code.
	 */
	id: string
}

const hookSets = new Map<string, HookSet>()

/** Which extension each set arrived with. Ownerless sets are core and cannot be switched off. */
const ownerById = new Map<string, string>()

export function registerHooks(hooks: HookSet, owner?: string): void {
	hookSets.set(hooks.id, hooks)
	if (owner !== undefined) ownerById.set(hooks.id, owner)
	else ownerById.delete(hooks.id)
}

export function clearHookRegistry(): void {
	hookSets.clear()
	ownerById.clear()
}

/**
 * The sets currently on offer.
 *
 * Enablement is read here, at fire time, rather than at registration — the same rule
 * `actionsForShape` and `fileImportFor` follow, and for the same reason: switching an extension off
 * in Settings has to stop its behaviour immediately, not at the next reload.
 */
function activeHooks(): HookSet[] {
	const active: HookSet[] = []
	for (const [id, hooks] of hookSets) {
		const owner = ownerById.get(id)
		if (owner === undefined || isExtensionEnabled(owner)) active.push(hooks)
	}
	return active
}

/**
 * Whether a reaction is already running.
 *
 * One flag for all three, so a hook's own writes never re-enter *any* hook. Coarse on purpose: a
 * chain of one step is occasionally what someone wants, and a loop — create writes a property, the
 * property write creates a shape — is what they get instead if this is clever. The rule is worth
 * being able to state in a sentence: hooks react to what the user did, not to each other.
 */
let firing = false

function fire<C>(name: keyof BoardHooks, ctx: C, pick: (hooks: HookSet) => ((ctx: C) => void) | undefined): void {
	if (firing) return
	firing = true
	try {
		for (const hooks of activeHooks()) {
			const handler = pick(hooks)
			if (!handler) continue
			try {
				handler(ctx)
			} catch (error) {
				console.error(`Hook "${hooks.id}".${name} failed`, error)
			}
		}
	} finally {
		firing = false
	}
}

export function fireBoardOpen(ctx: BoardOpenContext): void {
	fire('onBoardOpen', ctx, (hooks) => hooks.onBoardOpen?.bind(hooks))
}

export function fireShapeCreate(ctx: ShapeCreateContext): void {
	fire('onShapeCreate', ctx, (hooks) => hooks.onShapeCreate?.bind(hooks))
}

export function firePropertyChange(ctx: PropertyChangeContext): void {
	fire('onPropertyChange', ctx, (hooks) => hooks.onPropertyChange?.bind(hooks))
}

/**
 * Wires the shape hooks to one editor, returning a disposer — installed from the host's board mount
 * beside its other `watchX` installers.
 *
 * tldraw's side effects are the fire point rather than the app's own creation helpers, and that is
 * the load-bearing choice: `insertNode` is one of *six* ways a shape appears (the dock, the context
 * menu, a paste, a duplicate, a file import, an agent operation), and a hook wired to the helpers
 * would silently miss five of them.
 *
 * `source === 'user'` on both, for the reason `watchPastedProperties` already gives: loading a board
 * creates every shape on it, and re-running an auto-tagger over a whole board on open is a bug.
 */
export function installBoardHooks(editor: Editor): () => void {
	const stopCreate = editor.sideEffects.registerAfterCreateHandler('shape', (shape, source) => {
		if (source !== 'user') return
		fireShapeCreate({ editor, shape })
	})

	const stopChange = editor.sideEffects.registerAfterChangeHandler('shape', (prev, next, source) => {
		if (source !== 'user') return
		// Property values live in `meta`, which `updateShape` only replaces when something actually
		// changed — so this reference test is what keeps a drag (which rewrites x/y every frame) from
		// diffing anything at all.
		if (prev.meta === next.meta) return

		const before = readShapeProperties(prev)
		const after = readShapeProperties(next)
		for (const propertyId of new Set([...Object.keys(before), ...Object.keys(after)])) {
			const from = before[propertyId] ?? null
			const to = after[propertyId] ?? null
			if (from === to) continue
			firePropertyChange({ editor, shape: next, propertyId, before: from, after: to })
		}
	})

	return () => {
		stopCreate()
		stopChange()
	}
}
