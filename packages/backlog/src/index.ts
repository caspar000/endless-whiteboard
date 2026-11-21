/**
 * `@lifeboard/backlog`: one card for media you mean to get to, gathered from any source, and itself a
 * source for other cards (DARK-11).
 *
 * Reaches the host only through `@lifeboard/node-kit`'s barrel, like every extension package, and no
 * other extension at all: what it collects, and who reads it, meet in the kit's registry.
 */
// Registers `node.backlog` with tldraw's *type* system (see shape-types.ts). Imported for its side
// effect on the module graph; must stay above the value exports.
import './shape-types'
import { registerItemSource } from '@lifeboard/node-kit'
import { backlogSource } from './source'

// Each backlog, for a randomizer to shuffle or a ranking to sort.
registerItemSource(backlogSource)

export { backlogExtension } from './extension'
export { backlogNodeDefinition } from './definition'
export { BACKLOG_TYPE, type BacklogProps } from './props'
/** The vault's backlogs, which the app saves. */
export { backlogs } from './store'
