import { commandFromOperation, getOperation, registerCommand } from '@lifeboard/node-kit'
import type { CommandContext } from '@lifeboard/node-kit'
import { CANVAS_GROUP, INSERT_GROUP } from './paletteItems'

/**
 * The operations that are also worth reaching by hand — the third projection between registries,
 * after nodes → commands (`canvas/insertNode.ts`) and commands → the Help page.
 *
 * Curated rather than generated, and that is the point. Every operation is a tool for an agent; only
 * some of them are a *sentence a person would go looking for*. `view.select` takes a list of shape
 * ids, which nobody types; `node.image` takes a URL, which is exactly how you would add a picture
 * you found. Projecting the whole table would bury the palette in agent-shaped rows, so what belongs
 * in front of a person is a decision, made here, in one place.
 *
 * The command keeps the operation's id (`commandFromOperation`), so one capability has one name in
 * both tables — and the palette generates the argument pages from the operation's own `params`
 * rather than from anything written here.
 */
const PROJECTED: { id: string; title?: string; group: string }[] = [
	// No other door in the palette: images arrive by drop or paste today, which is no help when the
	// picture is behind a URL you have in the clipboard.
	{ id: 'node.image', title: 'Add an image from a URL', group: INSERT_GROUP },
	// Properties can only be defined from a shape's own panel, so defining one before there is
	// anything to put it on means creating a shape you did not want first.
	{ id: 'property.create', title: 'Define a property', group: CANVAS_GROUP },
]

const onBoard = (ctx: CommandContext) => ctx.editor !== null

/**
 * Called from the composition root *after* `registerCoreOperations()`, because it reads what that
 * registered — the same one-time-projection shape as `registerNodeCommands()`.
 */
export function registerOperationCommands(): void {
	for (const entry of PROJECTED) {
		const op = getOperation(entry.id)
		// A projection of a table that might not hold this row: an operation can arrive from an
		// extension, and one that is not installed in this build should cost nothing rather than throw.
		if (!op) continue
		registerCommand(
			commandFromOperation(op, {
				...(entry.title ? { title: entry.title } : {}),
				group: entry.group,
				// Both act on a board. `when` is availability, so on Home they are not offered at all
				// rather than offered and then failing with "no board is open".
				when: onBoard,
			})
		)
	}
}
