import {
	actionsForShape,
	getNodeDefinitions,
	getVisibleNodeDefinitions,
	isNodeTypeEnabled,
	subscribeToNodeDefinitions,
} from '@lifeboard/node-kit'
import { useSyncExternalStore } from 'react'
import {
	DefaultContextMenu,
	DefaultContextMenuContent,
	DefaultKeyboardShortcutsDialog,
	DefaultKeyboardShortcutsDialogContent,
	TldrawUiMenuGroup,
	TldrawUiMenuItem,
	useEditor,
	useValue,
	type TLComponents,
	type TLUiOverrides,
} from 'tldraw'
import { insertNode } from './insertNode'
import { toolIdForNodeType } from './nodeTools'
import { openProperties } from './propertiesTarget'

/**
 * Toolbar and shortcut entries for the node types, generated from the registry (§7: "Registry-driven
 * UI — no per-node-type hardcoding in toolbar/menus"). Adding a node type — or, later, installing a
 * plugin that supplies one — puts it in the toolbar with no change here.
 */
/**
 * Numeric shortcuts, `1`–`9` in the dock's own order (see CanvasToolbar). tldraw 5 binds only
 * letters, but numbers-by-position is the convention every comparable canvas app keeps, so the
 * dock restores it. The node tools take the numbers after these, assigned in registry order.
 */
const NUMBER_KBDS: Record<string, string> = {
	select: '1',
	hand: '2',
	frame: '3',
	arrow: '4',
	draw: '7',
	eraser: '8',
	text: '9',
}
const FIRST_NODE_NUMBER = 5
/**
 * The node run stops at 6 because 7–9 are already spoken for above.
 *
 * There are more dock buttons than digits — the sticky note, the shapes menu and the image button have
 * no number either — so a third node type takes its letter and no digit, rather than silently stealing
 * `7` from the pen.
 */
const LAST_NODE_NUMBER = 6

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
		/*
		 * tldraw's own grid toggle (⌘', and the checkbox in its main menu) is removed.
		 *
		 * It writes `isGridMode`, which the app now owns from Settings → Canvas — and tldraw persists
		 * that flag *per board*, so leaving the shortcut in place is what let one board end up with a grid
		 * the others did not have. It would also read as a lie: the app re-applies its own value whenever a
		 * board mounts, so toggling here would appear to work and then silently revert on reload. Deleting
		 * the action takes the menu item with it — tldraw's menu items render nothing for an action that
		 * does not exist.
		 */
		delete actions['toggle-grid']
		return actions
	},
	tools(editor, tools) {
		// Every non-deprecated type gets an entry — matching createNodeTools — because this map is
		// fixed at mount and a disabled extension can be re-enabled mid-session. The gate is in
		// `onSelect`: entries stay registered, but a disabled extension's shortcut does nothing, and
		// the dock only *shows* enabled types (CanvasToolbar reads the visible list reactively).
		const defs = getNodeDefinitions().filter((def) => !def.deprecated)
		defs.forEach((def, index) => {
			const id = toolIdForNodeType(def.type)
			// The letter is the definition's own (`kbd`), so an extension's node arrives with its
			// shortcut — checked by its author against tldraw's bindings (`r` and `g` are taken).
			const position = index + FIRST_NODE_NUMBER
			const number = position <= LAST_NODE_NUMBER ? String(position) : undefined
			const kbd = [def.kbd, number].filter(Boolean).join(',')
			tools[id] = {
				id,
				label: def.label,
				icon: glyphIcon(def.icon),
				...(kbd ? { kbd } : {}),
				onSelect() {
					if (!isNodeTypeEnabled(def.type)) return
					editor.setCurrentTool(id)
				},
			}
		})
		for (const [id, number] of Object.entries(NUMBER_KBDS)) {
			const tool = tools[id]
			if (!tool) continue
			tool.kbd = tool.kbd ? `${tool.kbd},${number}` : number
		}
		return tools
	},
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
 * Whatever the enabled extensions can do to the selected shape (see `ShapeAction`).
 *
 * Registry-driven like everything else here, so an extension's verb — "find this book's details" —
 * appears without the host knowing what it means, and disappears when the extension is switched
 * off. Only for a single selection: these act on one shape, and an action that silently applied to
 * the first of eleven would be worse than no action at all.
 */
function ExtensionActionItems() {
	const editor = useEditor()
	const shape = useValue(
		'lifeboard:action-target',
		() => {
			const ids = editor.getSelectedShapeIds()
			return ids.length === 1 ? (editor.getShape(ids[0]!) ?? null) : null
		},
		[editor]
	)
	if (!shape) return null
	const actions = actionsForShape(shape)
	if (!actions.length) return null

	return (
		<TldrawUiMenuGroup id="lifeboard-extension-actions">
			{actions.map((action) => (
				<TldrawUiMenuItem
					key={action.id}
					id={action.id}
					label={action.label}
					{...(action.icon ? { icon: glyphIcon('✦') } : {})}
					onSelect={() => {
						try {
							action.run({ editor, shape })
						} catch (error) {
							// One extension's bad action must not take the menu — or the board — down.
							console.error(`Extension action "${action.id}" failed`, error)
						}
					}}
				/>
			))}
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
	// Subscribed to the registry's own store so the menu tracks extension toggles — same seam as
	// the dock (see CanvasToolbar).
	const defs = useSyncExternalStore(subscribeToNodeDefinitions, getVisibleNodeDefinitions)
	return (
		<TldrawUiMenuGroup id="lifeboard-add">
			{defs.map((def) => (
				<TldrawUiMenuItem
					key={def.type}
					id={`lifeboard-add-${def.type}`}
					label={`Add ${def.label.toLowerCase()}`}
					icon={glyphIcon(def.icon)}
					onSelect={() => {
						// The right-click point: where the user was pointing when the menu opened. The
						// palette's "Add …" command runs the same `insertNode` at the viewport centre.
						insertNode(editor, def, editor.inputs.getCurrentPagePoint())
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
			<ExtensionActionItems />
			<AddToBoardItems />
			<DefaultContextMenuContent />
		</DefaultContextMenu>
	),
	KeyboardShortcutsDialog: (props) => (
		<DefaultKeyboardShortcutsDialog {...props}>
			<DefaultKeyboardShortcutsDialogContent />
		</DefaultKeyboardShortcutsDialog>
	),
}
