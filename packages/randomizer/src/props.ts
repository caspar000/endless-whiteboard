import type { ListId, RandomItem, RandomPick } from './model'

export const RANDOMIZER_TYPE = 'node.randomizer'

export interface RandomizerProps {
	/** Which list is showing: the Albums / Films / Books switch. */
	list: ListId
	/** Every list's items, each tagged with its list. */
	items: RandomItem[]
	/** What the shuffles landed on, newest first, a few per list (see `recordPick`). */
	picks: RandomPick[]
	/** See registry.tsx: `h` follows the card until a vertical handle pins it. */
	autoHeight: boolean
}
