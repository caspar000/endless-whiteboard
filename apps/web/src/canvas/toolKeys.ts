import { getNodeDefinitions } from '@lifeboard/node-kit'
import { toolIdForNodeType } from './nodeTools'

/**
 * Which key reaches which tool — the one place that decides, read by both the command table
 * (`toolCommands.ts`, which is what the keymap and the palette see) and tldraw's own tool overrides
 * (`uiOverrides.tsx`, which is what its tooltips and its ⌘/ dialog show).
 *
 * It was computed in `uiOverrides.tsx` alone while tldraw did the dispatching. Registering the tools
 * as commands gave the assignment a second reader, and two readers computing the same thing from
 * registry order is exactly how a dock button ends up advertising a key that moved.
 */

/**
 * Numeric shortcuts, `1`–`9` in the dock's own order (see CanvasToolbar). tldraw 5 binds only
 * letters, but numbers-by-position is the convention every comparable canvas app keeps, so the dock
 * restores it.
 *
 * The run reaches every dock button that is a tool, in order, and skips the one that is not: the
 * shapes button, because tldraw's map has an entry per geo *kind* rather than a single `geo` tool, so
 * there is nothing for a key to select. The node picker takes `0` (see `NODE_MENU_KBD`).
 *
 * It is contiguous now because the dock's own contents are fixed. The node types moved behind the
 * picker, so nothing an extension installs can appear between two of these buttons — which is what
 * the old assignment could not promise: it reserved `5`–`6` for the first two node types and left the
 * pen on `7`, a gap for anyone counting along the dock.
 */
const NUMBER_KBDS: Record<string, string> = {
	select: '1',
	hand: '2',
	frame: '3',
	arrow: '4',
	note: '5',
	draw: '6',
	eraser: '7',
	text: '8',
	// The only entry with a digit and no letter: tldraw binds none, and the dock's tenth button is the
	// picker, so `9` was going spare.
	asset: '9',
}

/**
 * The node picker, on `0` — the tenth thing in the dock, and the digit that comes round after the
 * nine. Not a tool: it opens the grid, and picking from the grid is what chooses a tool.
 */
export const NODE_MENU_KBD = '0'

/** tldraw's own tools, with the letters it binds them to. Its labels and icons stay tldraw's. */
const NATIVE_TOOL_LETTERS: Record<string, string> = {
	select: 'v',
	hand: 'h',
	frame: 'f',
	arrow: 'a',
	note: 'n',
	draw: 'd',
	eraser: 'e',
	text: 't',
}

/**
 * A tldraw tool id → the `Command.kbd` for it, alternates and all (`'v,1'`).
 *
 * Over the *union* of the two tables, not just the letters: the image tool has a digit and no letter,
 * and iterating the letters alone is how it would silently lose its key.
 */
export function nativeToolKbds(): Map<string, string> {
	const kbds = new Map<string, string>()
	const ids = new Set([...Object.keys(NATIVE_TOOL_LETTERS), ...Object.keys(NUMBER_KBDS)])
	for (const id of ids) {
		const kbd = [NATIVE_TOOL_LETTERS[id], NUMBER_KBDS[id]].filter(Boolean).join(',')
		if (kbd) kbds.set(id, kbd)
	}
	return kbds
}

/**
 * A node type's tool id → its `Command.kbd`. The letter is the definition's own, so an extension's
 * node arrives with its shortcut — checked by its author against tldraw's bindings.
 *
 * **Letters only, no digits.** The digits are the dock's, assigned by position, and the node types are
 * not in the dock any more — a node holding `5` while the sticky note sitting in the fifth slot did
 * not would be the assignment contradicting itself. A node type with no `kbd` of its own therefore has
 * no key at all, and is reached from the picker (`0`) or from ⌘K.
 *
 * Every non-deprecated type gets one, including a currently-disabled extension's: tldraw's tool map
 * is fixed at mount and an extension can be switched back on mid-session, so the entry stays and the
 * gate lives in what happens when the key is pressed.
 */
export function nodeToolKbds(): Map<string, string> {
	const kbds = new Map<string, string>()
	for (const def of getNodeDefinitions()) {
		if (def.deprecated || !def.kbd) continue
		kbds.set(toolIdForNodeType(def.type), def.kbd)
	}
	return kbds
}
