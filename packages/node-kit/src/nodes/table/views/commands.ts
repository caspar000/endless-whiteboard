import type { TLShape } from 'tldraw'
import type { Command, CommandContext } from '../../../commands'
import { getViewDefinitions } from './index'
import { setViewMode } from './mode'

/**
 * Switching a view from the keyboard — one command per view, alongside the config panel's switcher.
 *
 * Both doors, deliberately: the panel is where you go when you are already configuring the thing, and
 * ⌘K is how you change your mind about a table you are merely looking at. The same reasoning the
 * relation view's four commands are written down with (`appCommands.ts`).
 *
 * All views are always offered, including the one already showing. A list whose entries came and went
 * as you switched would be a list you had to read before using; and "Show as a table" on a table is a
 * command that does nothing, not one that misleads.
 *
 * Takes the node type rather than importing it, which keeps this module free of the definition it is
 * assembled into — `definition.tsx` already imports the component, and a second edge back would make
 * the cycle load-order-sensitive rather than merely theoretical.
 */
export function viewCommands(nodeType: string): Command[] {
	return getViewDefinitions().map((view) => ({
		id: `${nodeType}.view.${view.mode}`,
		title: `Show as ${view.label}`,
		/*
		 * A string by value: a package must not import the app's `paletteItems.ts`. 'Canvas' is where
		 * the other verbs about a selected shape live (properties, hide relation), so an unrecognised
		 * group cannot strand these in a trailing section of their own.
		 */
		group: 'Canvas',
		when: (ctx) => selectedTable(ctx, nodeType) !== null,
		run: (ctx) => {
			const editor = ctx.editor
			const shape = selectedTable(ctx, nodeType)
			if (!editor || !shape) return
			// The same path the config panel takes: switching a view is more than writing a mode, and one
			// of the two doors quietly missing a step is exactly how they drift.
			setViewMode(editor, shape, view.mode)
		},
	}))
}

/**
 * The one selected table, or `null`.
 *
 * Exactly one, not "the first of several": with two tables selected, "Show as a table" would silently
 * pick one of them, and a command that acts on an unpredictable member of your selection is worse than
 * one that isn't offered. The same rule the relation commands settled on.
 */
function selectedTable(ctx: CommandContext, nodeType: string): TLShape | null {
	const shape = ctx.editor?.getOnlySelectedShape()
	return shape?.type === nodeType ? shape : null
}
