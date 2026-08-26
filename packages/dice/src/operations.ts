import {
	defineOperation,
	fail,
	ok,
	reportAgentActivity,
	type RegisteredOperation,
} from '@lifeboard/node-kit'
import { DIE_KINDS } from './kinds'
import { parseNotation } from './notation'
import { throwCounts } from './rolls'

/**
 * Rolling, for a caller that is not holding a mouse.
 *
 * An operation rather than only a command because "roll me a d20" is a request with an *argument* and
 * an *answer* — which is exactly the line `operations.ts` draws between the two tables. It also comes
 * with an MCP tool for free: the server holds no list, so contributing an operation contributes a tool.
 *
 * It rolls on the board rather than in the abstract, on purpose. A model can generate a random number
 * by itself — badly, but it can. What it cannot do is put the roll in front of the person watching, at
 * a spot on their canvas, with the dice visible. That is the whole value here, which is why this
 * reports to the presence channel and throws at the middle of the viewport rather than returning a
 * number and leaving the board untouched.
 */
export const diceOperations: readonly RegisteredOperation[] = [
	defineOperation({
		id: 'dice.roll',
		title: 'Roll dice',
		description: [
			'Rolls dice on the board the user is looking at, where they can see them.',
			`Takes standard dice notation — "2d6 + 1d12", "3d8", "d20". The dice are ${DIE_KINDS.join(', ')};`,
			'there are no modifiers, so add or subtract from the total yourself and say so.',
			'Returns each die and the total.',
		].join(' '),
		params: {
			notation: {
				type: 'string',
				description:
					'What to roll, in dice notation: "d20", "2d6", "2d6 + 1d12". A term without a count means one die.',
				required: true,
			},
		},
		/*
		 * Not read-only. It writes no record — this phase leaves nothing on the board — but it *is* a
		 * side effect: it throws dice in front of somebody and it consumes randomness, so calling it
		 * twice is not the same as calling it once. `readOnly` gates a mode meant to be safe to hand an
		 * untrusted agent, and "may I animate on your screen" is not a question that mode should answer
		 * for the user.
		 */
		run: async (ctx, args) => {
			if (!ctx.editor) {
				return fail('No board is open. Open a board and try again — dice are rolled on a board.')
			}

			const parsed = parseNotation(args.notation)
			// The parser's failures are already sentences naming the alternatives, so they are returned
			// verbatim rather than wrapped in a second, vaguer one.
			if (!parsed.ok) return fail(parsed.error)

			const { center } = ctx.editor.getViewportPageBounds()
			const point = { x: center.x, y: center.y }
			const { result } = throwCounts(point, parsed.counts)

			// The cursor, so the person watching sees *where* it happened rather than dice appearing out
			// of nowhere. `create` is the nearest of the six kinds: something arrived on the board.
			reportAgentActivity({
				kind: 'create',
				operation: 'dice.roll',
				verb: `Rolling ${result.notation}`,
				editor: ctx.editor,
				shapes: [],
				point,
			})

			return ok({
				notation: result.notation,
				dice: result.dice.map((die) => ({ die: die.kind, value: die.value })),
				total: result.total,
			})
		},
	}),
]
