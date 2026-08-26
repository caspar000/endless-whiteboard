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
 * the ⌘K palette, the Help page's shortcut list, Settings → Keyboard, and the keyboard dispatcher
 * itself. One entry here and every surface follows, the same rule the node registry already enforces
 * for shapes: no per-command branching in the UI, ever.
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
	/**
	 * Secondary text a surface may show beside the title — what this will do, or what is wrong with what
	 * you have typed so far.
	 *
	 * Exists for the commands a `CommandSource` builds, where the *title* is the answer and there is
	 * still something worth saying: `> roll` has to be able to teach the notation, and `> roll 2d7` has
	 * to be able to say why nothing will happen. A static command rarely needs one — its title is the
	 * whole of it.
	 */
	hint?: string
	/**
	 * `false` means "shown, but nothing will happen" — a row that exists to explain itself.
	 *
	 * Deliberately narrow. A palette full of dead rows would be miserable, and `when` already exists for
	 * "do not offer this at all". This is for the case in between, which query-driven commands create:
	 * silence in answer to a half-typed expression reads as the feature being broken, and the useful
	 * reply is the reason rather than nothing.
	 */
	runnable?: boolean
	/** Optional richer row icon (the app chrome uses lucide). Structural, like the node registry's. */
	icon?: NodeToolbarIcon
	/**
	 * The **default** key binding, which the user's keymap may override (`keymap.ts`).
	 *
	 * No longer documentation only: the app dispatches from this table, so declaring a `kbd` here is
	 * what actually binds the key. Ask `bindingFor(id)`/`chordsFor(id)` for what a command answers to
	 * *now* — a surface that renders `kbd` directly will keep advertising a chord the user has moved.
	 *
	 * Same syntax tldraw's overrides use, alternates included: `'cmd+z'`, `'alt+p'`, `'shift+1'`,
	 * `'v,1'`.
	 */
	kbd?: string
	/**
	 * Availability, checked by consumers at render and again at invoke. Absent means always. Keep it
	 * cheap and pure — the palette calls it once per command per keystroke.
	 */
	when?: (ctx: CommandContext) => boolean
	run: (ctx: CommandContext) => void | Promise<void>
}

/**
 * A command built from what the user typed, rather than one that exists in advance.
 *
 * The command table answers "what can I do?"; this answers "what can I do *with this*". Some verbs
 * genuinely take an argument, and the palette is where it is already being typed — `> roll 2d20 + 10`
 * is one string, and splitting it into a command and a prompt would make it two interactions.
 *
 * Deliberately a *source of commands* rather than a `Command` with parameters. A command stays the
 * zero-argument button every surface can render (`commands.ts`'s whole premise), and what varies is
 * how many of them there are — so the palette needs no notion of arguments, keybindings still bind to
 * ordinary commands, and the Help page can keep listing what exists without having to invent examples.
 *
 * Called on **every keystroke** in the palette, so `offer` must be cheap and must return nothing
 * rather than something apologetic when the query is not for it.
 */
export interface CommandSource {
	/** Namespaced like a command: `dice.roll.notation`. */
	id: string
	/**
	 * The commands this source offers for `query` — the palette's text with its `>` already stripped.
	 * Return `[]` when the query is not addressed to it, which is almost always.
	 */
	offer(query: string, ctx: CommandContext): Command[]
}

const commands = new Map<string, Command>()
const sources = new Map<string, CommandSource>()
const sourceOwnerById = new Map<string, string>()

/** Which extension registered each command. Commands with no owner are core and cannot toggle off. */
const ownerById = new Map<string, string>()

const listeners = new Set<() => void>()

/**
 * The visible list, cached so it is a *stable snapshot* between changes — same contract as
 * `getVisibleNodeDefinitions`, for the same `useSyncExternalStore` reason.
 */
let visibleCache: Command[] | null = null
let sourceCache: CommandSource[] | null = null

function invalidate(): void {
	visibleCache = null
	sourceCache = null
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

/** Registers a query-driven source of commands — see {@link CommandSource}. */
export function registerCommandSource(source: CommandSource, owner?: string): void {
	sources.set(source.id, source)
	if (owner !== undefined) sourceOwnerById.set(source.id, owner)
	else sourceOwnerById.delete(source.id)
	invalidate()
}

/**
 * The sources a user should be offered, by the same enablement rule as commands: an extension switched
 * off stops offering, and its dynamic commands go with its static ones.
 */
export function getVisibleCommandSources(): CommandSource[] {
	sourceCache ??= [...sources.values()].filter((source) => {
		const owner = sourceOwnerById.get(source.id)
		return owner === undefined || isExtensionEnabled(owner)
	})
	return sourceCache
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
	sources.clear()
	sourceOwnerById.clear()
	invalidate()
}
