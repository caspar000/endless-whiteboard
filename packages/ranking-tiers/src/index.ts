/**
 * `@lifeboard/ranking-tiers`: a card that sorts the items of any source into tiers, optionally weighted
 * for a randomizer to draw from (DARK-11).
 *
 * Reaches the host only through `@lifeboard/node-kit`'s barrel, like every extension package, and no
 * other extension at all: what it ranks, and who draws from it, meet in the kit's registry.
 */
// Registers `node.ranking` with tldraw's *type* system (see shape-types.ts). Imported for its side
// effect on the module graph; must stay above the value exports.
import './shape-types'
import { registerItemSource } from '@lifeboard/node-kit'
import { rankingSource } from './source'

// A ranking with weighted shuffle on, for a randomizer to draw from by its tiers' weights.
registerItemSource(rankingSource)

export { rankingTiersExtension } from './extension'
export { rankingNodeDefinition } from './definition'
export { RANKING_TYPE, type RankingProps } from './props'
/** For the help page, which draws its demo with the real odds. */
export { DEFAULT_TIERS, formatOdds, tierShares } from './model'
/** The vault's rankings, which the app saves. */
export { rankings } from './store'
