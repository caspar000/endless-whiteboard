import { getVisibleNodeDefinitions } from '@lifeboard/node-kit'
import {
	DefaultContextMenu,
	DefaultContextMenuContent,
	DefaultKeyboardShortcutsDialog,
	DefaultKeyboardShortcutsDialogContent,
	DefaultToolbar,
	DefaultToolbarContent,
	TldrawUiMenuGroup,
	TldrawUiMenuItem,
	useEditor,
	useIsToolSelected,
	useTools,
	useValue,
	createShapeId,
	type TLComponents,
	type TLUiOverrides,
} from 'tldraw'
import { toolIdForNodeType } from './nodeTools'
import { openProperties } from './propertiesTarget'

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
	'node.markdown': 'n',
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
	actions(editor, actions) {
		// `alt+p` is free in tldraw's own set (`cmd+p` is print, `alt+r`/`alt+f`/`alt+t` are taken).
		actions['lifeboard-properties'] = {
			id: 'lifeboard-properties',
			label: 'Properties',
			kbd: 'alt+p',
			onSelect() {
				const selected = editor.getSelectedShapeIds()
				// One shape only: properties are per-shape, and a panel that silently edited several at
				// once would be a different feature with different undo semantics.
				if (selected.length === 1) openProperties(selected[0]!)
			},
		}
		return actions
	},
	tools(editor, tools) {
		for (const def of getVisibleNodeDefinitions()) {
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
			{getVisibleNodeDefinitions().map((def) => (
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

/**
 * "Properties" on a shape's context menu.
 *
 * Right-click is the primary way in, because **⌘-click is not available**: tldraw's select tool already
 * uses `accelKey` on a shape click (selecting inside a group), so taking it would fight the editor. The
 * plan called for ⌘-click; `alt+p` is the accelerator instead.
 *
 * Deliberately *not* double-click, which keeps meaning "edit the content" — that separation is what
 * lets a note be both prose and a row of data.
 */
function PropertiesMenuItem() {
	const editor = useEditor()
	const selectedIds = useValue('lifeboard:selected', () => editor.getSelectedShapeIds(), [editor])
	if (selectedIds.length !== 1) return null
	return (
		<TldrawUiMenuGroup id="lifeboard-properties-group">
			<TldrawUiMenuItem
				id="lifeboard-properties"
				label="Properties"
				icon={glyphIcon('◫')}
				kbd="alt+p"
				onSelect={() => openProperties(selectedIds[0]!)}
			/>
		</TldrawUiMenuGroup>
	)
}

/**
 * "Add to board" on the canvas context menu.
 *
 * Double-clicking empty canvas now creates a note outright — which is what makes writing the default
 * action, but it also means nothing surfaces the other node types any more. Right-click keeps them
 * discoverable, and stays registry-driven so a new type (or a plugin's) appears here for free.
 */
function AddToBoardItems() {
	const editor = useEditor()
	return (
		<TldrawUiMenuGroup id="lifeboard-add">
			{getVisibleNodeDefinitions().map((def) => (
				<TldrawUiMenuItem
					key={def.type}
					id={`lifeboard-add-${def.type}`}
					label={`Add ${def.label.toLowerCase()}`}
					icon={glyphIcon(def.icon)}
					onSelect={() => {
						// The right-click point: where the user was pointing when the menu opened.
						const point = editor.inputs.getCurrentPagePoint()
						const id = createShapeId()
						editor.run(() => {
							editor.markHistoryStoppingPoint('create node')
							editor.createShapes([
								{
									id,
									type: def.type,
									x: point.x - def.defaultSize.w / 2,
									y: point.y - def.defaultSize.h / 2,
								} as never,
							])
							editor.select(id)
						})
						const shape = editor.getShape(id)
						if (shape && editor.canEditShape(shape)) editor.setEditingShape(id)
					}}
				/>
			))}
		</TldrawUiMenuGroup>
	)
}

export const nodeComponents: TLComponents = {
	ContextMenu: (props) => (
		<DefaultContextMenu {...props}>
			<PropertiesMenuItem />
			<AddToBoardItems />
			<DefaultContextMenuContent />
		</DefaultContextMenu>
	),
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
