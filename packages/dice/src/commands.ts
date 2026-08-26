import type { Command, CommandContext, CommandSource } from '@lifeboard/node-kit'
import type { Editor } from 'tldraw'
import { DieIcon } from './DieIcon'
import { clearHand, getHand, loadDie } from './hand'
import { DIE_KINDS, type DieKind } from './kinds'
import { formatNotation, parseNotation } from './notation'
import { throwCounts, throwHand } from './rolls'

/**
 * What the tray offers the command palette — and, through the same table, the Help page's shortcut
 * list and any keymap that comes later.
 *
 * The palette's job here is not to be a faster tray; it is to be the surface that *names* the tray.
 * Someone who has not noticed a strip of polygons down the edge of their board will type "dice", and
 * these are what answers.
 *
 * Deliberately no default `kbd` on any of them. The letters are tldraw's (tools) and the digits are
 * the dock's (`uiOverrides.tsx` assigns 1–9 by position), and the README's rule for taking one is to
 * check first — a clash does not warn, it just makes the letter quietly do something else.
 */

/** This extension's own palette section. A string by value: a package must not import the app's. */
const DICE_GROUP = 'Dice'

const onBoard = (ctx: CommandContext) => ctx.editor !== null
const holding = (ctx: CommandContext) => ctx.editor !== null && getHand().total > 0

/**
 * Where a roll with no pointer behind it lands: the middle of what you are looking at.
 *
 * `dice.roll` can be invoked from the palette, where there is no release point — and dropping the
 * dice at the page origin would throw them somewhere off-screen, which reads as nothing happening.
 */
function viewportCentre(editor: Editor): { x: number; y: number } {
	const { center } = editor.getViewportPageBounds()
	return { x: center.x, y: center.y }
}

/**
 * One "Load a d20" per die, generated from the one table rather than written out seven times — the
 * same rule the dock follows for node types, and the reason adding a die kind adds its command.
 */
const loadCommands: Command[] = DIE_KINDS.map((kind: DieKind) => ({
	id: `dice.load.${kind}`,
	title: `Load a ${kind}`,
	group: DICE_GROUP,
	icon: () => DieIcon({ kind, size: 15 }),
	when: onBoard,
	run: () => loadDie(kind),
}))

export const diceCommands: readonly Command[] = [
	...loadCommands,
	{
		id: 'dice.roll',
		title: 'Roll the dice in hand',
		group: DICE_GROUP,
		// Offered only with something to throw. A "roll" that rolls nothing is the palette telling you
		// it did something when it did not.
		when: holding,
		run: (ctx) => {
			if (ctx.editor) throwHand(viewportCentre(ctx.editor))
		},
	},
	{
		id: 'dice.clear',
		title: 'Put the dice back',
		group: DICE_GROUP,
		when: holding,
		run: () => clearHand(),
	},
]

/** The word that opens a typed roll: `> roll 2d20 + 10`. */
const ROLL_WORD = 'roll'

/**
 * Rolling a notation typed straight into the palette — `> roll 2d20 + 10`.
 *
 * The one verb here that genuinely takes an argument, which is why it is a `CommandSource` rather than
 * a command (see node-kit's `commands.ts`). It also does the thing the tray cannot: a **modifier**.
 * There is no way to pick up "+10" off a shelf of dice, and `2d20 + 10` is how everyone writes it
 * anyway.
 *
 * It throws immediately rather than loading the hand. Someone who has typed the whole expression has
 * already decided; handing them a loaded cursor and asking them to click would be making them say it
 * twice.
 *
 * Nothing is offered unless the notation *parses*. A palette row you can press Enter on that then does
 * nothing is worse than no row, and the errors `parseNotation` produces are written for an agent
 * reading a tool result rather than for someone mid-keystroke.
 */
export const diceCommandSource: CommandSource = {
	id: 'dice.roll.notation',
	offer(query, ctx) {
		const editor = ctx.editor
		if (!editor) return []

		const trimmed = query.trim()
		// The first word, and whatever follows it. `roll` on its own is browsing; `roll 2d6` is an order.
		const split = /^(\S*)\s*([\s\S]*)$/.exec(trimmed)
		const word = (split?.[1] ?? '').toLowerCase()
		const notation = (split?.[2] ?? '').trim()

		/*
		 * With no argument yet, this is an ordinary browsable command and has to behave like one.
		 *
		 * `ROLL_WORD.startsWith(word)` rather than the other way round, so an empty query, `r`, `ro`, `rol`
		 * and `roll` all find it — which is what "visible and browsable in ⌘K" means. Matching only the
		 * complete word made it a command you had to already know the name of, and a palette you cannot
		 * browse is a palette that hides half of what it can do.
		 */
		if (!notation) {
			if (!ROLL_WORD.startsWith(word)) return []
			return [
				{
					id: 'dice.roll.notation',
					title: 'Roll a d20',
					group: DICE_GROUP,
					hint: 'or type a notation — 2d20 + 10, 1d6 + 2d4 + 4',
					run: () => throwCounts(viewportCentre(editor), new Map([['d20', 1]])),
				},
			]
		}

		// With an argument, the word has to be exact: `rollup 2d6` is a different thing entirely.
		if (word !== ROLL_WORD) return []

		const parsed = parseNotation(notation)

		/*
		 * A notation that does not parse gets a row that says why, and does nothing.
		 *
		 * The same correction the agent's `dice.roll` returns, shown where it was typed — because half of
		 * every expression is briefly invalid on the way to being valid, and disappearing during that is
		 * what made this confusing in the first place. `runnable: false` is what keeps it from being a
		 * dead Enter.
		 */
		if (!parsed.ok) {
			return [
				{
					id: 'dice.roll.notation',
					title: `Roll ${notation}`,
					group: DICE_GROUP,
					hint: parsed.error,
					runnable: false,
					run: () => {},
				},
			]
		}

		return [
			{
				id: 'dice.roll.notation',
				title: `Roll ${formatNotation(parsed.counts, parsed.modifier)}`,
				group: DICE_GROUP,
				hint: 'in the middle of the view',
				run: () => {
					// A typed roll has no release point, and the page origin would land it somewhere off
					// screen, which reads as nothing having happened.
					throwCounts(viewportCentre(editor), parsed.counts, parsed.modifier)
				},
			},
		]
	},
}
