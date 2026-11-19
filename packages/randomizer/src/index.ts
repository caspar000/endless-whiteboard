/**
 * `@lifeboard/randomizer`: a card that picks at random from a list, with a split-flap shuffle.
 *
 * Reaches the host only through `@lifeboard/node-kit`'s barrel, like every extension package.
 */
// Registers `node.randomizer` with tldraw's *type* system (see shape-types.ts). Imported for its side
// effect on the module graph; must stay above the value exports.
import './shape-types'

export { randomizerExtension } from './extension'
export { randomizerNodeDefinition } from './definition'
export { RANDOMIZER_TYPE, type RandomizerProps } from './props'
export { SHUFFLE_COMMAND_ID } from './commands'
/** For the help page, which draws its demo with the real stamps and lists. */
export { Postmark } from './Postmark'
export { LISTS, STAMPS, STAMP_KINDS, flipCount, type ListId, type RandomItem, type StampKind } from './model'
