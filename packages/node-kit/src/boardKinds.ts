import { react, type Editor, type TLShape } from '@lifeboard/canvas'
import type { ComponentType } from 'react'
import { getExtensions } from './extensions'
import { isExtensionEnabled, type NodeToolbarIcon } from './registry'

/**
 * A kind of board an extension defines: not a shape on a board but what the board itself is
 * (docs/zettelkasten-plan.md, "The seam: board kinds").
 *
 * The other contributions add things to boards. A Zettelkasten box needs the board to be something
 * else: a dock of its own instead of the drawing tools, and a rule that nothing but its own cards goes
 * on it. The board index doesn't know about kinds. What makes a board one is written into the board's
 * own content by `create`, so it travels wherever the board does (sync, a move to the server, a
 * backup), and `isKind` reads it back from there.
 *
 * Switching the extension off makes its boards ordinary again: they open with the ordinary dock and
 * accept anything, and their shapes keep rendering, the same "stop offering, never stop working" rule
 * as everything else.
 */
export interface BoardKind {
	/** Namespaced like an extension id: `zettelkasten.box`. */
	id: string
	/** What one is called: `Box`. */
	name: string
	/** The command that makes one, as ⌘K and the new-board menu show it: `New box`. */
	label: string
	/** The name a new one starts with: `Untitled box`. */
	newName: string
	/** The board icon a new one is given (a name from the app's icon set), so its tab and card say what it is. */
	boardIcon?: string
	icon: NodeToolbarIcon
	/** Whether an open board is one of these. Called from render and from reactions, so keep it cheap. */
	isKind(editor: Editor): boolean
	/** Makes a fresh, empty board one of these. Runs once, on the board's first open. */
	create(editor: Editor): void
	/** Drawn instead of the dock while a board of this kind is open. No props, like an overlay. */
	Dock: ComponentType
	/** The shape types a board of this kind may hold. Anything else is taken off again as it arrives. */
	allowedShapes: readonly string[]
}

/** Every registered kind, with the extension it came from, switched off or not. */
export function getAllBoardKinds(): { kind: BoardKind; owner: string }[] {
	return getExtensions().flatMap((ext) => (ext.boardKinds ?? []).map((kind) => ({ kind, owner: ext.id })))
}

export function getBoardKind(id: string): BoardKind | undefined {
	return getAllBoardKinds().find(({ kind }) => kind.id === id)?.kind
}

/**
 * The kind of the open board, if an enabled extension claims it.
 *
 * Reactive inside `useValue` and `react` as far as `isKind` reads the store. Enablement is not a
 * signal (see the registry), so a component also subscribes to `subscribeToNodeDefinitions`.
 */
export function boardKindOf(editor: Editor): BoardKind | null {
	for (const { kind, owner } of getAllBoardKinds()) {
		if (isExtensionEnabled(owner) && kind.isKind(editor)) return kind
	}
	return null
}

/** Tools a board of any kind keeps: getting around and looking, nothing that draws. */
const KEPT_TOOLS = new Set(['select', 'hand', 'zoom', 'laser'])

/**
 * Holds a board to its kind's rules for as long as the editor lives.
 *
 * Two doors stay open whatever the dock shows, and both are closed here rather than at each place a
 * shape can come from (a tool key, a paste, a drop, an agent): a drawing tool picked by its key is put
 * back to Select, and a shape of a type the kind doesn't allow is taken off as it arrives. Only this
 * device's own changes are checked. Another device holds itself to the rule, and one running an older
 * build shouldn't have its shapes deleted here behind its back.
 */
export function holdBoardToKind(editor: Editor): () => void {
	// The current tool is the editor's state chart, not a record, so a store listener never hears it.
	const stopTools = react('lifeboard:board-kind-tools', () => {
		const tool = editor.getCurrentToolId()
		if (KEPT_TOOLS.has(tool) || !boardKindOf(editor)) return
		// Not from inside the reaction that saw it: the tool is still being entered.
		queueMicrotask(() => {
			if (!KEPT_TOOLS.has(editor.getCurrentToolId())) editor.setCurrentTool('select')
		})
	})
	const stopShapes = editor.sideEffects.registerAfterCreateHandler('shape', (shape: TLShape, source) => {
		if (source !== 'user') return
		const kind = boardKindOf(editor)
		if (!kind || kind.allowedShapes.includes(shape.type)) return
		editor.deleteShapes([shape.id])
	})
	return () => {
		stopTools()
		stopShapes()
	}
}
