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
 * restores it. The node tools take the numbers after these, assigned in registry order.
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
 * There are more dock buttons than digits — the sticky note, the shapes menu and the image button
 * have no number either — so a third node type takes its letter and no digit, rather than silently
 * stealing `7` from the pen.
 */
const LAST_NODE_NUMBER = 6

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

/** A tldraw tool id → the `Command.kbd` for it, alternates and all (`'v,1'`). */
export function nativeToolKbds(): Map<string, string> {
	const kbds = new Map<string, string>()
	for (const [id, letter] of Object.entries(NATIVE_TOOL_LETTERS)) {
		const number = NUMBER_KBDS[id]
		kbds.set(id, number ? `${letter},${number}` : letter)
	}
	return kbds
}

/**
 * A node type's tool id → its `Command.kbd`. The letter is the definition's own, so an extension's
 * node arrives with its shortcut — checked by its author against tldraw's bindings.
 *
 * Every non-deprecated type gets one, including a currently-disabled extension's: tldraw's tool map
 * is fixed at mount and an extension can be switched back on mid-session, so the entry stays and the
 * gate lives in what happens when the key is pressed.
 */
export function nodeToolKbds(): Map<string, string> {
	const kbds = new Map<string, string>()
	getNodeDefinitions()
		.filter((def) => !def.deprecated)
		.forEach((def, index) => {
			const position = index + FIRST_NODE_NUMBER
			const number = position <= LAST_NODE_NUMBER ? String(position) : undefined
			const kbd = [def.kbd, number].filter(Boolean).join(',')
			if (kbd) kbds.set(toolIdForNodeType(def.type), kbd)
		})
	return kbds
}
