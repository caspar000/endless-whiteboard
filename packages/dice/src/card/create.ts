import { createNodeShape, createProperty, updateShapeProperties } from '@lifeboard/node-kit'
import type { Editor } from 'tldraw'
import type { ActiveRoll } from '../rolls'
import { ROLL_NODE_TYPE, rollNodeDefinition } from './definition'
import { encodeDice } from './encode'

/** The board property a kept roll writes its total to, so a table can count and sum rolls. */
export const ROLL_TOTAL_PROPERTY = 'Roll total'

/**
 * Writes a roll onto the board, once its dice have stopped.
 *
 * Placed on the resting pile rather than at the release point: the dice have moved since you let go,
 * and a card describing them belongs where they ended up. The same `settlement` the readout is
 * positioned from, so the card lands where the readout would have.
 *
 * **One history entry.** `createNodeShape` opens its own `editor.run`, and the property write is a
 * second one, so both are wrapped here — otherwise ⌘Z after a roll would undo the total and leave a
 * blank card behind.
 */
export function createRollCard(editor: Editor, roll: ActiveRoll): void {
	const settlement = roll.settlement
	if (!settlement || roll.result.dice.length === 0) return

	// Just below the pile's top edge, which is where the readout sits — the card takes its place.
	const at = { x: settlement.centreX, y: settlement.top }

	editor.markHistoryStoppingPoint()
	editor.run(() => {
		const id = createNodeShape(editor, rollNodeDefinition as never, at, {
			notation: roll.result.notation,
			faces: encodeDice(roll.result.dice),
			modifier: roll.result.modifier,
			total: roll.result.total,
		})

		/*
		 * The total, as a property.
		 *
		 * This is the payoff for the card being a real node rather than a picture: a number the property
		 * system knows about is a number a table can group by, total and filter on. `createProperty`
		 * returns any existing definition untouched, so this neither duplicates the property nor undoes a
		 * rename someone made in the panel.
		 */
		const def = createProperty(editor, { name: ROLL_TOTAL_PROPERTY, type: 'number' })
		const shape = editor.getShape(id)
		if (def && shape) updateShapeProperties(editor, shape, { [def.id]: roll.result.total })
	})
}

export { ROLL_NODE_TYPE }
