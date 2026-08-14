import type { Editor } from 'tldraw'
import { registerCommand, type Command } from './commands'
import { registerOperation, type RegisteredOperation } from './operations'
import {
	isExtensionEnabled,
	isNodeType,
	registerNode,
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
	/** File types this extension imports on drop/paste. Gated by enablement at drop time. */
	fileImports?: readonly FileImport[]
	/** Actions offered on a shape's context menu. Gated by enablement when the menu opens. */
	actions?: readonly ShapeAction[]
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
 * Registers an extension and every node, command and operation it contributes.
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
	for (const op of ext.operations ?? []) registerOperation(op, ext.id)
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
}
