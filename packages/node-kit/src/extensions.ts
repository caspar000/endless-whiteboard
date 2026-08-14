import { registerCommand, type Command } from './commands'
import { isNodeType, registerNode, type NodeDefinition, type NodeToolbarIcon } from './registry'

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
	description?: string
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
 * Registers an extension and every node and command it contributes.
 *
 * Idempotent by id — a second registration is ignored, not an error — for the same reason
 * `registerBuiltinNodes` guards per node: module re-evaluation (vite HMR, a test importing two
 * modules that both pull in the composition root) must not throw.
 */
export function registerExtension(ext: Extension): void {
	if (extensions.has(ext.id)) return
	extensions.set(ext.id, ext)
	for (const def of ext.nodes) {
		if (!isNodeType(def.type)) registerNode(def, ext.id)
	}
	for (const cmd of ext.commands ?? []) registerCommand(cmd, ext.id)
}

/** Registration order, which is also toolbar order for their nodes. */
export function getExtensions(): Extension[] {
	return [...extensions.values()]
}

export function getExtension(id: string): Extension | undefined {
	return extensions.get(id)
}

/** Used by tests to get a clean slate. Pair with `clearNodeRegistry`. */
export function clearExtensionRegistry(): void {
	extensions.clear()
}
