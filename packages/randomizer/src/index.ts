/**
 * `@lifeboard/randomizer`: a card that picks at random from a list, with a split-flap shuffle.
 *
 * Reaches the host only through `@lifeboard/node-kit`'s barrel, like every extension package.
 */
// Registers `node.randomizer` with tldraw's *type* system (see shape-types.ts). Imported for its side
// effect on the module graph; must stay above the value exports.
import './shape-types'
import { registerItemSource } from '@lifeboard/node-kit'
import { stampedSource } from './stamped'

// "Everything I liked", and the other stamps, for any card that takes a list (DARK-11).
registerItemSource(stampedSource)

export { randomizerExtension } from './extension'
export { randomizerNodeDefinition } from './definition'
export { RANDOMIZER_TYPE, type RandomizerProps } from './props'
export { SHUFFLE_COMMAND_ID } from './commands'
/** For the help page, which draws its demo with the real stamps and lists. */
export { Postmark } from './Postmark'
export { STAMPS, STAMP_KINDS, flipCount, type RandomItem, type SourceEntry, type SourceKind, type StampKind } from './model'
/** The vault's list of everything stamped, which the app saves (DARK-11). */
export { getStamped, replaceStamped, setStampedPersistence, type StampedEntry } from './stamped'
