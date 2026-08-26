import { defineNode, type CanvasOverlay, type Extension } from '@lifeboard/node-kit'
import { Dices } from 'lucide-react'
import { diceCommandSource, diceCommands } from './commands'
import { DiceSettings } from './DiceSettings'
import { rollNodeDefinition } from './card/definition'
import { DiceOverlay } from './DiceOverlay'
import { diceOperations } from './operations'

const diceTray: CanvasOverlay = {
	id: 'lifeboard.dice.tray',
	Component: DiceOverlay,
}

/**
 * Dice on the whiteboard.
 *
 * The first extension that contributes **no node types at all** — only chrome, commands and an
 * operation. That is the point of it being here rather than in the app: if an extension can put a
 * working control on the canvas through the same door a third-party plugin will use, the door is real.
 *
 * It is also the first one whose state is entirely outside the store. Nothing about holding or
 * rolling dice writes a record, which is why none of it costs an undo entry and why a board with the
 * tray on the screen behaves exactly like one without it.
 */
export const diceExtension: Extension = {
	id: 'lifeboard.dice',
	name: 'Dice',
	description:
		'A tray of dice down the edge of the board. Click to load them — d6 twice and a d12 makes 2d6 + 1d12, and your cursor says so — then click the board to throw them where you dropped them.',
	details: [
		'Click a die in the tray to pick one up, and click again for another. The cursor carries what you are holding, so you can see what you are about to throw before you throw it. Right-click a die in the tray to put one back, Escape to put them all back.',
		'Click anywhere on the board to roll. The result appears at the spot you threw at and stays glued to it while you pan and zoom, then fades. Nothing is written to the board, so a roll costs no undo entry — the board you had before the roll is the board you have after it.',
		'Every face comes from the browser’s cryptographic random source, sampled so that each face is exactly equally likely. A d20 here is a fair d20, which the obvious way of writing it would not have been.',
		'Typing “> roll 2d20 + 10” into ⌘K throws that immediately into the middle of the view, without loading anything — and it takes a flat modifier, which a shelf of dice has no way to express.',
		'A roll leaves nothing behind by default — it is a moment, not a record. Switch “Keep results” on and each roll lands as a card instead, with its total as a property, so a table can group and sum your rolls like anything else on the board.',
		'Settings → Extensions → Dice colours the set, or gives every die its own colour, and controls the line round each face. The numerals are not a choice: they go light on a dark die and dark on a light one, because a die you cannot read is not a die.',
		'The agent can roll too: ask it for “2d6 + 1d12” and it throws them on the board you are looking at rather than making a number up.',
		'Turning this off takes the tray, the commands and the agent operation away. There is nothing left behind to keep rendering, because rolling never wrote anything down.',
	],
	icon: Dices,
	version: '0.1.0',
	author: 'Lifeboard',
	/*
	 * One node type, and it is optional in a way no other extension's is: a roll only leaves a card
	 * behind if you have asked it to (Settings → Extensions → Dice). The type is registered either way,
	 * because a board that already has roll cards on it has to keep opening.
	 */
	nodes: [defineNode(rollNodeDefinition)],
	commands: diceCommands,
	commandSources: [diceCommandSource],
	settings: { title: 'Appearance', Component: DiceSettings },
	operations: diceOperations,
	overlays: [diceTray],
}
