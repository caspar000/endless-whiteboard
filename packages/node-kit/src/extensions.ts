import type { ComponentType } from 'react'
import type { Editor } from 'tldraw'
import { registerQuery, type NamedQuery } from './collections/namedQueries'
import {
	registerCommand,
	registerCommandSource,
	type Command,
	type CommandSource,
} from './commands'
import { registerHooks, type BoardHooks } from './hooks'
import { registerOperation, type RegisteredOperation } from './operations'
import {
	isExtensionEnabled,
	isNodeType,
	registerNode,
	subscribeToNodeDefinitions,
	type NodeDefinition,
	type NodeToolbarIcon,
} from './registry'

export interface FileImportContext {
	editor: Editor
	file: File
	/** Page coordinates to create content at — the drop point, already spread out per file. */
	point: { x: number; y: number }
}

/**
 * An extension's claim on dropped (or pasted) files: "these extensions are mine, and this is what
 * happens when one lands on the canvas".
 *
 * The app owns the actual `files` external-content handler — it matches each incoming file against
 * the enabled extensions' imports and hands the rest to tldraw's default pipeline (images, videos).
 * The import only ever sees files it claimed, one call per file.
 */
/**
 * Something an extension can do to one shape, offered on that shape's context menu.
 *
 * The second contribution kind, after `fileImports`, and the one that lets an extension add a
 * *verb* rather than a noun — "look this book up", "re-render this page" — without the host
 * knowing what any of them mean.
 */
export interface ShapeAction {
	/** Namespaced like an extension id: `<extension>.<verb>`. */
	id: string
	label: string
	icon?: NodeToolbarIcon
	/** Which shapes this applies to. Called for the single selected shape, so keep it cheap. */
	appliesTo(shape: { type: string }): boolean
	/** Errors are caught and logged by the host; long work should show its own progress. */
	run(ctx: { editor: Editor; shape: { id: string; type: string } }): void
}

/**
 * What landed on the canvas that was not a file: a dropped or pasted URL, or a run of text.
 *
 * `FileImport`'s sibling, and deliberately the same *claim* contract rather than a hook — exactly one
 * extension gets the content, because two extensions both turning a dropped link into a shape would
 * produce two shapes. That is why the issue's `onDrop` is here and not in `hooks.ts`: reacting and
 * claiming are different promises, and a mechanism that did both would have to answer "what happens
 * if two of you want it" with a coin toss.
 *
 * Anything unclaimed continues into tldraw's own pipeline — which already turns a URL into a bookmark
 * card and text into a text shape — exactly as if no extension were installed.
 */
export interface ContentImportContext {
	editor: Editor
	/** The URL or text as it arrived, untrimmed. */
	text: string
	/** Page coordinates to create content at — the drop point, or the middle of the view on a paste. */
	point: { x: number; y: number }
}

export interface ContentImport {
	/** Whether this import wants it. Called per drop against each enabled extension, so keep it cheap. */
	matches(text: string): boolean
	/** Errors are caught and toasted by the app, as for `fileImports`. */
	onText(ctx: ContentImportContext): Promise<void>
}

export interface FileImport {
	/**
	 * Lowercased filename suffixes without the leading dot — `['pdf', 'epub', 'fb2.zip']`. Matched
	 * with `endsWith`, so compound suffixes work. Matching is by name, not MIME type: browsers report
	 * book formats inconsistently (`.epub` arrives as an empty type on some platforms), while the
	 * suffix is what the user can actually see.
	 */
	extensions: readonly string[]
	/** Creates whatever shapes the file becomes. Errors are caught and toasted by the app. */
	onFile(ctx: FileImportContext): Promise<void>
}

/**
 * Something an extension draws *over the board*, rather than on it.
 *
 * The third contribution kind that is neither a noun nor a verb: a tray, a readout, a laser pointer —
 * chrome that belongs to the canvas but is not a shape and therefore has nowhere else to live. Until
 * this existed an extension could contribute a node, a command, a file type and a menu entry, and had
 * no way at all to put a control on screen.
 *
 * The component is rendered in tldraw's `InFrontOfTheCanvas` slot: screen space, above every shape,
 * *inside* the editor context, so it may call `useEditor` and `useValue` and track the camera the way
 * the agent's cursor does.
 *
 * It is handed **no props**, deliberately. Everything it needs it reads from the editor context or
 * from its own module-scope state — the same discipline `CommandContext` is held to, and for the same
 * reason: an interface that grows a field per feature stops being a seam. It is also why an overlay is
 * free to be a plugin's later, having been given no host capability it wasn't granted on purpose.
 */
export interface CanvasOverlay {
	/** Namespaced like an extension id: `<extension>.<name>`. */
	id: string
	/**
	 * Rendered on every board, for as long as the extension is enabled — so it must decide for itself
	 * whether it has anything to show, and render nothing when it does not.
	 *
	 * Two obligations come with that. It must not take pointer events unless it is genuinely claiming
	 * the gesture, since a transparent layer over the canvas that swallows clicks is indistinguishable
	 * from a broken board. And it must not write to the store on a frame loop: `e2e/perf.spec.ts`
	 * asserts zero rollup recomputes during a drag, and an overlay animating through the store is the
	 * one way to break that from outside the app.
	 */
	Component: ComponentType
}

/**
 * An extension is a named bag of contributions the app composes at startup — today that means node
 * definitions; later contribution kinds (store migrations, text-editor extensions, expression
 * functions) are added as optional fields, so existing extensions keep compiling.
 *
 * This is the unit users see in Settings → Extensions and the unit enablement toggles. Disabling one
 * hides its nodes from every creation surface (`getVisibleNodeDefinitions`) while its types stay in
 * the schema, so boards that already contain them keep opening and rendering.
 *
 * It is also, unchanged, the future plugin manifest: a runtime-loaded plugin is just something that
 * supplies an `Extension` through this same door (§4.1).
 */
export interface Extension {
	/** Namespaced and stable: `lifeboard.<name>` for first-party, `<vendor>.<name>` later. */
	id: string
	/** Shown in Settings → Extensions. */
	name: string
	/** One or two sentences, shown on the card. Clamped to three lines there, so lead with the point. */
	description?: string
	/**
	 * The long copy, one string per paragraph, shown on the extension's own page in Settings.
	 *
	 * Separate from `description` because the two are read in different situations: the card's job is
	 * to let someone skim a grid and decide, the page's is to answer "what do I actually get, and what
	 * happens if I turn it off". Optional — an extension with none still gets a page, built from its
	 * description and the contributions below, which are facts the manifest already carries.
	 */
	details?: readonly string[]
	/** Card icon for Settings → Extensions. Usually the same icon its main node puts in the dock. */
	icon?: NodeToolbarIcon
	/** Shown on the card, dimmed — `0.1.0`, no leading `v`. */
	version?: string
	author?: string
	nodes: readonly NodeDefinition<never>[]
	/**
	 * Commands this extension contributes — to the ⌘K palette and every other command surface, since
	 * they all read the one registry. Disabling the extension hides them (`getVisibleCommands`),
	 * the same "stop offering, never stop working" rule as its nodes.
	 */
	commands?: readonly Command[]
	/**
	 * Operations this extension contributes — the parameterised, result-returning table agents drive
	 * the app through (`operations.ts`). Same enablement rule as its commands, and the reason the MCP
	 * server needs no list of tools: contributing an operation contributes a tool.
	 */
	operations?: readonly RegisteredOperation[]
	/**
	 * Named questions this extension teaches the board — `{runway}` for `sum cash page`.
	 *
	 * Vocabulary rather than capability, which is why it is a separate field from `commands`: these
	 * appear in the `{…}` menu of every note and in ⌘K's `=` mode, and are hidden with the extension
	 * like everything else it contributes.
	 */
	queries?: readonly NamedQuery[]
	/** File types this extension imports on drop/paste. Gated by enablement at drop time. */
	fileImports?: readonly FileImport[]
	/** Dropped or pasted URLs and text this extension claims. Same gating as `fileImports`. */
	contentImports?: readonly ContentImport[]
	/**
	 * Behaviour rather than capability: what this extension does *because* the board changed.
	 *
	 * The extension's own id is the hook set's id, so there is nothing to name here. Switched off with
	 * the extension, checked at fire time — see `hooks.ts` for why reactions cannot claim, cannot be
	 * async, and cannot re-enter each other.
	 */
	hooks?: BoardHooks
	/** Actions offered on a shape's context menu. Gated by enablement when the menu opens. */
	actions?: readonly ShapeAction[]
	/**
	 * Chrome this extension draws over the board — see {@link CanvasOverlay}. Same enablement rule as
	 * its commands: switching the extension off takes the overlay off screen, live, with no remount.
	 */
	overlays?: readonly CanvasOverlay[]
	/**
	 * Commands built from what the user typed in the palette — see {@link CommandSource}. For verbs that
	 * genuinely take an argument, like rolling a notation.
	 */
	commandSources?: readonly CommandSource[]
	/**
	 * The extension's own controls, rendered on its page in Settings → Extensions.
	 *
	 * Everything else on that page is *derived* from this manifest — what it adds, what happens if you
	 * turn it off — which is the point of the manifest being the unit of packaging. But an extension with
	 * preferences of its own has nowhere to put them, and "add a tab to the app's Settings" is not
	 * something a third-party plugin can be allowed to do. This is the seam: the host owns the page, the
	 * extension owns one panel on it.
	 *
	 * Rendered above the derived sections, because a setting is something you came to do and a
	 * contribution list is something you came to read.
	 */
	settings?: {
		/** Section heading, e.g. `Appearance`. */
		title: string
		/** Takes no props, for the same reason a `CanvasOverlay` does not: it owns its own state. */
		Component: ComponentType
	}
}

/**
 * Erases a definition's props type so definitions with different props can share an extension's
 * `nodes` list. `NodeDefinition<Props>` is invariant in `Props` (validators are covariant, the
 * component contravariant), so there is no common supertype to declare the list as — the same reason
 * `registerNode` casts internally. This is the one blessed cast an extension author needs; their
 * definition is still fully checked against `NodeDefinition<Props>` first.
 */
export function defineNode<Props extends object>(def: NodeDefinition<Props>): NodeDefinition<never> {
	return def as unknown as NodeDefinition<never>
}

const extensions = new Map<string, Extension>()

/**
 * The canvas-overlay store, in the shape `commands.ts` established: a listener set, a snapshot cached
 * so it is stable between changes, and `subscribeToNodeDefinitions` chained in because that is where
 * extension enablement lives.
 *
 * A store of its own rather than reusing the node registry's, because an extension may contribute an
 * overlay and no node types — the dice tray does — and registering it would then notify nobody.
 */
const overlayListeners = new Set<() => void>()
let overlayCache: CanvasOverlay[] | null = null

function invalidateOverlays(): void {
	overlayCache = null
	for (const listener of overlayListeners) listener()
}

// An enablement flip changes what should be on screen, and enablement is the node registry's state.
subscribeToNodeDefinitions(invalidateOverlays)

/**
 * Notifies on any change to which overlays should be drawn — a registration, or an extension being
 * switched on or off. Pair with `getVisibleCanvasOverlays` in `useSyncExternalStore`.
 */
export function subscribeToCanvasOverlays(listener: () => void): () => void {
	overlayListeners.add(listener)
	return () => {
		overlayListeners.delete(listener)
	}
}

/**
 * The overlays the board should draw, in registration order.
 *
 * A stable snapshot between changes, like `getVisibleCommands` and `getVisibleNodeDefinitions` — a
 * fresh array each call would make `useSyncExternalStore` re-render forever.
 */
export function getVisibleCanvasOverlays(): CanvasOverlay[] {
	overlayCache ??= [...extensions.values()]
		.filter((ext) => ext.overlays?.length && isExtensionEnabled(ext.id))
		.flatMap((ext) => [...(ext.overlays ?? [])])
	return overlayCache
}

/**
 * Registers an extension and every node, command, command source, operation and query it contributes.
 *
 * Idempotent *per node type*, not per extension — a second registration is reconciled, not ignored,
 * and never throws. Module re-evaluation is the normal case here (vite HMR, a test importing two
 * modules that both pull in the composition root).
 *
 * The per-node guard is what matters, and getting it wrong cost a crash: an early return on a known
 * extension id meant that when an extension *gained* a node type, a re-registration against a
 * surviving registry silently skipped it. The schema then had no shape util for a type the code was
 * already creating — "No shape util found for type …", i.e. a dead board until a full reload.
 */
export function registerExtension(ext: Extension): void {
	// Replaced rather than kept: a reloaded module's definitions are the current ones.
	extensions.set(ext.id, ext)
	for (const def of ext.nodes) {
		if (!isNodeType(def.type)) registerNode(def, ext.id)
	}
	for (const cmd of ext.commands ?? []) registerCommand(cmd, ext.id)
	for (const source of ext.commandSources ?? []) registerCommandSource(source, ext.id)
	for (const op of ext.operations ?? []) registerOperation(op, ext.id)
	for (const query of ext.queries ?? []) registerQuery(query, ext.id)
	if (ext.hooks) registerHooks({ id: ext.id, ...ext.hooks }, ext.id)
	// Unconditional: the record above was *replaced*, so a re-registration under HMR has just swapped
	// in a fresh component identity even when the overlay list looks unchanged.
	invalidateOverlays()
}

/** Registration order, which is also toolbar order for their nodes. */
export function getExtensions(): Extension[] {
	return [...extensions.values()]
}

export function getExtension(id: string): Extension | undefined {
	return extensions.get(id)
}

/**
 * The import that claims this filename, or undefined if no enabled extension wants it.
 *
 * Checked at drop time, not registration time, so toggling an extension off in Settings immediately
 * returns its file types to tldraw's default handling — same gating rule as the creation tools.
 */
/**
 * The actions enabled extensions offer for this shape, in registration order.
 *
 * Enablement is checked here rather than at registration for the same reason it is for file
 * imports: switching an extension off in Settings takes its verbs off the menu immediately.
 */
export function actionsForShape(shape: { type: string }): ShapeAction[] {
	const found: ShapeAction[] = []
	for (const ext of extensions.values()) {
		if (!ext.actions?.length || !isExtensionEnabled(ext.id)) continue
		for (const action of ext.actions) {
			if (action.appliesTo(shape)) found.push(action)
		}
	}
	return found
}

/**
 * The import that claims this text, or undefined if no enabled extension wants it.
 *
 * Registration order decides, like `fileImportFor` — first claim wins. Checked at drop time so
 * switching an extension off returns its content types to tldraw's default handling immediately.
 */
export function contentImportFor(text: string): ContentImport | undefined {
	for (const ext of extensions.values()) {
		if (!ext.contentImports?.length || !isExtensionEnabled(ext.id)) continue
		for (const contentImport of ext.contentImports) {
			try {
				if (contentImport.matches(text)) return contentImport
			} catch (error) {
				// A bad matcher costs its own extension the claim, not everyone else theirs.
				console.error(`Content import matcher in "${ext.id}" failed`, error)
			}
		}
	}
	return undefined
}

export function fileImportFor(fileName: string): FileImport | undefined {
	const name = fileName.toLowerCase()
	for (const ext of extensions.values()) {
		if (!ext.fileImports?.length || !isExtensionEnabled(ext.id)) continue
		for (const fileImport of ext.fileImports) {
			if (fileImport.extensions.some((suffix) => name.endsWith(`.${suffix}`))) return fileImport
		}
	}
	return undefined
}

/** Used by tests to get a clean slate. Pair with `clearNodeRegistry`. */
export function clearExtensionRegistry(): void {
	extensions.clear()
	invalidateOverlays()
}
