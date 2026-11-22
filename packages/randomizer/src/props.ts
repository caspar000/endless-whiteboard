import type { RandomItem, RandomPick } from './model'

export const RANDOMIZER_TYPE = 'node.randomizer'

export interface RandomizerProps {
	/** What the card shuffles, as a source key (`model.ts`): `''` for none yet, `list`, `feeds:all`. */
	source: string
	/** The typed list's items, and whatever the card keeps for other sources' (their stamps). */
	items: RandomItem[]
	/** What the shuffles landed on, newest first, a few per source (see `recordPick`). */
	picks: RandomPick[]
	/** See registry.tsx: `h` follows the card until a vertical handle pins it. */
	autoHeight: boolean
	/** The window's shape, as the kit's `COVER_ASPECTS` names it: '' is square (DARK-13). */
	aspect: string
}
