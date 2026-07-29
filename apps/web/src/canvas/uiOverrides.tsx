import { getNodeDefinitions } from '@lifeboard/node-kit'
import {
	DefaultKeyboardShortcutsDialog,
	DefaultKeyboardShortcutsDialogContent,
	DefaultToolbar,
	DefaultToolbarContent,
	TldrawUiMenuItem,
	useIsToolSelected,
	useTools,
	type TLComponents,
	type TLUiOverrides,
} from 'tldraw'
import { toolIdForNodeType } from './nodeTools'

/**
 * Toolbar and shortcut entries for the node types, generated from the registry (§7: "Registry-driven
 * UI — no per-node-type hardcoding in toolbar/menus"). Adding a node type — or, later, installing a
 * plugin that supplies one — puts it in the toolbar with no change here.
 */
/**
 * Keyed by node type. These are checked against tldraw's own shortcuts — `r` is the rectangle tool
 * and `g` is an action, so neither is available; `m`, `i` and `s` are free.
 */
const KBD_BY_TYPE: Record<string, string> = {
	'node.markdown': 'm',
	'node.item': 'i',
	'node.rollup': 's',
}

/**
 * A definition's `icon` is a glyph ("M", "▤", "Σ"), not one of tldraw's built-in icon names — a
 * registry entry (and later a plugin) has no way to know those. Passing the string straight through
 * made tldraw look up a non-existent icon and render three identical "?" buttons, so the glyph is
 * wrapped as JSX instead, which `TLUiIconJsx` explicitly supports.
 */
function glyphIcon(glyph: string) {
	return <div className="lb-tool-icon">{glyph}</div>
}

export const nodeUiOverrides: TLUiOverrides = {
	tools(editor, tools) {
		for (const def of getNodeDefinitions()) {
			const id = toolIdForNodeType(def.type)
			tools[id] = {
				id,
				label: def.label,
				icon: glyphIcon(def.icon),
				kbd: KBD_BY_TYPE[def.type],
				onSelect() {
					editor.setCurrentTool(id)
				},
			}
		}
		return tools
	},
}

function NodeToolbarItems() {
	const tools = useTools()
	// `useIsToolSelected` is a hook, so it cannot be called inside a loop over a dynamic list
	// without breaking hook ordering. Each entry is therefore its own component.
	return (
		<>
			{getNodeDefinitions().map((def) => (
				<NodeToolbarItem key={def.type} toolId={toolIdForNodeType(def.type)} tools={tools} />
			))}
		</>
	)
}

function NodeToolbarItem({
	toolId,
	tools,
}: {
	toolId: string
	tools: ReturnType<typeof useTools>
}) {
	const tool = tools[toolId]
	const isSelected = useIsToolSelected(tool)
	if (!tool) return null
	return <TldrawUiMenuItem {...tool} isSelected={isSelected} />
}

export const nodeComponents: TLComponents = {
	Toolbar: (props) => (
		<DefaultToolbar {...props}>
			<NodeToolbarItems />
			<DefaultToolbarContent />
		</DefaultToolbar>
	),
	KeyboardShortcutsDialog: (props) => (
		<DefaultKeyboardShortcutsDialog {...props}>
			<DefaultKeyboardShortcutsDialogContent />
		</DefaultKeyboardShortcutsDialog>
	),
}
