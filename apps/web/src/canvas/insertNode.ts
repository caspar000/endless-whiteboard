import {
	createNodeShape,
	getNodeDefinitions,
	getNodeOwner,
	registerCommand,
	type NodeDefinition,
} from '@lifeboard/node-kit'
import type { Editor, TLShapeId } from 'tldraw'
import { INSERT_GROUP } from '../app/paletteItems'

/**
 * Puts a node of `def`'s type on the board, centred on `point`: one history entry, selected, and in
 * edit mode if the type can be edited.
 *
 * Factored out of the context menu so the right-click entry and the palette's "Add …" command are
 * one action rather than two that drift — the second caller is exactly when a copied implementation
 * starts quietly diverging (the marked stopping point, the selection, the edit-mode hand-off).
 *
 * The creation itself now lives in node-kit (`createNodeShape`), because the agent operations create
 * the same shape and must *not* inherit the rest of this: selecting and entering edit mode are right
 * for a person who just clicked "Add note" and wrong for a caller with nobody at the keyboard.
 */
export function insertNode(
	editor: Editor,
	def: NodeDefinition<never>,
	point: { x: number; y: number }
): void {
	let id: TLShapeId | undefined
	editor.run(() => {
		editor.markHistoryStoppingPoint('create node')
		// Nested inside this `run` on purpose: creation and selection stay in one batch behind one
		// stopping point, so ⌘Z after an insert undoes the whole thing.
		id = createNodeShape(editor, def, point)
		editor.select(id)
	})
	if (!id) return
	const shape = editor.getShape(id)
	if (shape && editor.canEditShape(shape)) editor.setEditingShape(id)
}

/**
 * Registers one "Add <node>" command per registered type — the command table's half of the
 * registry-driven rule the dock and context menu already follow: adding a node type (or installing a
 * plugin that supplies one) puts it in the palette with no change here.
 *
 * Called from the composition root *after* the extensions are registered, because it reads the node
 * registry: commands are a static table, so this is a one-time projection of one registry onto
 * another rather than something that re-derives itself.
 *
 * Each command is owned by the extension that supplied the node, so a single toggle takes the node
 * and everything generated from it out of the UI together.
 */
export function registerNodeCommands(): void {
	for (const def of getNodeDefinitions()) {
		// Deprecated types stay in the schema so old boards keep opening, but must never be offered.
		if (def.deprecated) continue
		registerCommand(
			{
				// `node.markdown` → `node.markdown.insert`: the type is already namespaced.
				id: `${def.type}.insert`,
				title: `Add ${def.label.toLowerCase()}`,
				group: INSERT_GROUP,
				icon: def.toolbarIcon,
				when: (ctx) => ctx.editor !== null,
				run: (ctx) => {
					const editor = ctx.editor
					if (!editor) return
					// The middle of what you are looking at. The context menu uses the pointer instead —
					// same action, different answer to "where".
					insertNode(editor, def, editor.getViewportPageBounds().center)
				},
			},
			getNodeOwner(def.type)
		)
	}
}
