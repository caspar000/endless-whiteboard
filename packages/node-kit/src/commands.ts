import type { Editor } from 'tldraw'
import { isExtensionEnabled, subscribeToNodeDefinitions, type NodeToolbarIcon } from './registry'

/**
 * Which top-level surface is showing. Mirrors the app's `Route['view']` — declared here
 * structurally so a command (including a future plugin's) can gate on it without importing app code.
 */
export type CommandView = 'list' | 'settings' | 'help' | 'board'

/**
 * What a command runs against. Built fresh by the invoker — the palette, a keymap, a test — at the
 * moment of invocation, never stored, so a command can never act on a stale board.
 *
 * Deliberately minimal: the editor and the surface. App-owned capability (navigation, board CRUD,
 * theme) does not pass through here — app commands close over the app's own API instead (see the
 * web app's `appCommands.ts`) — so this interface never grows a field per feature, and a
 * plugin-supplied command never sees more capability than the SDK deliberately grants it.
 */
export interface CommandContext {
	/** The active board's editor; `null` on the home screen, Settings and Help. */
	editor: Editor | null
	view: CommandView
}

/**
 * A user-invokable action. The registry of these is the single table every command surface reads —
 * the ⌘K palette first; the Help page's shortcut list, generated tldraw overrides and a
 * user-rebindable keymap later. One entry here and every surface follows, the same rule the node
 * registry already enforces for shapes: no per-command branching in the UI, ever.
 */
export interface Command {
	/**
	 * Namespaced and stable: `board.new`, `view.help`, `node.note.insert`. This is the id users —
	 * keymaps, expressions, other extensions — will reference, so renaming one is a breaking change.
	 */
	id: string
	/** Imperative and short, as shown in the palette: “New board”, “Zoom to fit”. */
	title: string
	/** Palette section and (later) Help grouping. Commands without one land in a trailing bucket. */
	group?: string
	/** Optional richer row icon (the app chrome uses lucide). Structural, like the node registry's. */
	icon?: NodeToolbarIcon
	/**
	 * The *default* key binding — and today documentation only: dispatch stays with whoever owns the
	 * key (tldraw for canvas keys, the palette hook for its own). Kept on the command so the palette
	 * row, the Help page and a future user keymap all read one source and can never drift apart.
	 * Same syntax tldraw's overrides use: `'cmd+z'`, `'alt+p'`, `'shift+1'`.
	 */
	kbd?: string
	/**
	 * Availability, checked by consumers at render and again at invoke. Absent means always. Keep it
	 * cheap and pure — the palette calls it once per command per keystroke.
	 */
	when?: (ctx: CommandContext) => boolean
	run: (ctx: CommandContext) => void | Promise<void>
}

const commands = new Map<string, Command>()

/** Which extension registered each command. Commands with no owner are core and cannot toggle off. */
const ownerById = new Map<string, string>()

const listeners = new Set<() => void>()

/**
 * The visible list, cached so it is a *stable snapshot* between changes — same contract as
 * `getVisibleNodeDefinitions`, for the same `useSyncExternalStore` reason.
 */
let visibleCache: Command[] | null = null

function invalidate(): void {
	visibleCache = null
	for (const listener of listeners) listener()
}

// Extension toggles change what command surfaces should offer, and enablement lives in the node
// registry's store — so chain its notifications rather than duplicating the state here. The node
// registry notifies on any offering change, which is exactly the set of events that matter.
subscribeToNodeDefinitions(invalidate)

/**
 * Notifies on any change to what command surfaces should offer — a registration or an extension
 * enablement flip. Subscribe via `useSyncExternalStore` with `getVisibleCommands` as the snapshot.
 */
export function subscribeToCommands(listener: () => void): () => void {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

/**
 * Registers a command. Re-registration by id **replaces** — neither throws like `registerNode`
 * (there is no schema to protect) nor ignores like `registerExtension`: under HMR the module
 * defining a command re-evaluates with fresh closures while this registry persists, and keeping
 * the stale entry would leave the palette running dead code.
 */
export function registerCommand(
	command: Command,
	/** The extension this command arrived with; registrations without one are core, always offered. */
	owner?: string
): void {
	commands.set(command.id, command)
	if (owner !== undefined) ownerById.set(command.id, owner)
	else ownerById.delete(command.id)
	invalidate()
}

export function getCommand(id: string): Command | undefined {
	return commands.get(id)
}

/** Every registered command in registration order, regardless of extension enablement. */
export function getCommands(): Command[] {
	return [...commands.values()]
}

/**
 * The commands a user should be offered: those whose owning extension is enabled — "off" means
 * "stop offering", exactly as for nodes. `when` is deliberately *not* consulted here: it needs a
 * live `CommandContext`, so consumers apply it per render. Stable snapshot between changes.
 */
export function getVisibleCommands(): Command[] {
	visibleCache ??= [...commands.values()].filter((cmd) => {
		const owner = ownerById.get(cmd.id)
		return owner === undefined || isExtensionEnabled(owner)
	})
	return visibleCache
}

/** Used by tests to get a clean slate. Pair with `clearNodeRegistry`/`clearExtensionRegistry`. */
export function clearCommandRegistry(): void {
	commands.clear()
	ownerById.clear()
	invalidate()
}
