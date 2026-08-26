/**
 * `@lifeboard/dice` — dice you can throw on the board.
 *
 * Reaches the host only through `@lifeboard/node-kit`'s barrel, like every extension package: that is
 * the same door a runtime-loaded plugin comes through, so anything this needs and cannot get is a gap
 * in the SDK rather than a reason to import from `apps/web`.
 */
// Registers `node.roll` with tldraw's *type* system (see shape-types.ts). Imported for its side effect
// on the module graph — must stay above the value exports.
import './shape-types'

export { diceExtension } from './extension'
export { ROLL_NODE_TYPE, rollNodeDefinition, type RollNodeProps } from './card/definition'
export { ROLL_TOTAL_PROPERTY, createRollCard } from './card/create'
export { decodeDice, encodeDice } from './card/encode'
export { diceCommandSource } from './commands'
/**
 * How the dice look. Lives outside the lazily-loaded 3D chunk on purpose — Settings has to show and
 * change these without pulling three.js in, and the renderer reads them rather than holding a copy.
 */
export {
	DEFAULT_DICE_COLOUR,
	DEFAULT_DICE_PREFS,
	DICE_PALETTE,
	bodyColourFor,
	edgeColourFor,
	getDicePrefs,
	inkOn,
	setDicePrefs,
	subscribeToDicePrefs,
	type DicePrefs,
} from './prefs'
/**
 * Exported for the app's **help page**, which draws a mock tray and has to draw it with the real die
 * silhouettes — a help page that invents its own icons is one that stops matching the app the first
 * time these change. Same reason `@lifeboard/book-reader` exports its tag and suffix tables.
 */
export { DieIcon, toneFor, type DieTone } from './DieIcon'
export { DIE_KINDS, MAX_DICE_IN_HAND, facesOf, isDieKind, type DieKind } from './kinds'
export { formatNotation, parseNotation, type ParseResult } from './notation'
export { randomFace, rollCounts, type RandomBytes, type RolledDie, type RollResult } from './roll'
export {
	clearHand,
	getHand,
	loadDie,
	subscribeToHand,
	takeHand,
	unloadDie,
	type Hand,
} from './hand'
export {
	clearRolls,
	getActiveRoll,
	subscribeToRolls,
	throwCounts,
	throwHand,
	type ActiveRoll,
} from './rolls'
