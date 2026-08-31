import {
	getNodeDefinitions,
	getNodeOwner,
	isNodeTypeEnabled,
	registerCommand,
	type CommandContext,
} from '@lifeboard/node-kit'
import { toggleNodeMenu } from './nodeMenuState'
import { toolIdForNodeType } from './nodeTools'
import { runTldrawTool } from './tldrawUi'
import { NODE_MENU_KBD, nativeToolKbds, nodeToolKbds } from './toolKeys'

/**
 * The dock's tools, as commands.
 *
 * Deliberately skipped in Phase 3: the Help page's dock tour already documented every tool and its
 * letter, so registering them then would have duplicated that rather than replaced it. The keymap is
 * what changes the calculus — once the app dispatches keys from the table, a tool key that is *not*
 * in the table is a key the user cannot rebind, and the tour becomes the only place it is written
 * down. Now the table is the source and the tour reads it.
 *
 * It also puts the tools in ⌘K for free, which is the incidental half of the reason.
 */
const TOOLS_GROUP = 'Tools'

/** tldraw's own tools, with the label a person would search for rather than tldraw's i18n key. */
const NATIVE_TOOL_TITLES: Record<string, string> = {
	select: 'Select',
	hand: 'Hand — pan the board',
	frame: 'Frame',
	arrow: 'Arrow',
	note: 'Sticky note',
	draw: 'Pen',
	eraser: 'Eraser',
	text: 'Text',
	// tldraw's own tool, and the one whose `onSelect` opens a file dialog rather than arming a click.
	// In the table so the dock's image button has a key like every other tool in its group.
	asset: 'Image — place a file',
}

const onBoard = (ctx: CommandContext) => ctx.editor !== null

export function registerToolCommands(): void {
	const nativeKbds = nativeToolKbds()
	for (const [id, title] of Object.entries(NATIVE_TOOL_TITLES)) {
		const kbd = nativeKbds.get(id)
		registerCommand({
			id: `tool.${id}`,
			title,
			group: TOOLS_GROUP,
			...(kbd ? { kbd } : {}),
			when: onBoard,
			// Through tldraw's own tool rather than `setCurrentTool`, which matters for at least the
			// select tool: its `onSelect` leaves edit mode first, because editing is a sub-state of
			// select and a locked text tool would otherwise strand the caret there.
			run: (ctx) => {
				if (ctx.editor) runTldrawTool(ctx.editor, id)
			},
		})
	}

	/*
	 * The dock's node picker (see `NodeMenu.tsx`), which is not a tool but sits with them and is
	 * reached the same way — so it belongs in this group, where somebody looking for "how do I get a
	 * table" will find it next to the tables.
	 *
	 * Registered here rather than as an app command because it acts on **this board's** dock: the
	 * picker's open flag is keyed by editor, since every open tab keeps a mounted one.
	 */
	registerCommand({
		id: 'tool.nodes',
		title: 'Node types…',
		group: TOOLS_GROUP,
		kbd: NODE_MENU_KBD,
		when: onBoard,
		run: (ctx) => {
			if (ctx.editor) toggleNodeMenu(ctx.editor)
		},
	})

	const nodeKbds = nodeToolKbds()
	for (const def of getNodeDefinitions()) {
		if (def.deprecated) continue
		const toolId = toolIdForNodeType(def.type)
		const kbd = nodeKbds.get(toolId)
		registerCommand(
			{
				id: `tool.${def.type}`,
				title: def.label,
				group: TOOLS_GROUP,
				icon: def.toolbarIcon,
				...(kbd ? { kbd } : {}),
				// Enablement is checked here as well as by the owner below, because the *tool* survives
				// an extension being switched off (tldraw's map is fixed at mount) even though the
				// command does not. Belt to that braces.
				when: (ctx) => onBoard(ctx) && isNodeTypeEnabled(def.type),
				run: (ctx) => {
					if (ctx.editor) runTldrawTool(ctx.editor, toolId)
				},
			},
			getNodeOwner(def.type)
		)
	}
}
