import { T } from '@lifeboard/canvas'
import { createShapePropsMigrationIds, createShapePropsMigrationSequence, type NodeDefinition } from '@lifeboard/node-kit'
import { Shuffle } from 'lucide-react'
import { NO_SOURCE, STAMP_KINDS, oneTypedList, type ThreeListProps } from './model'
import { RANDOMIZER_TYPE, type RandomizerProps } from './props'
import { RandomizerCard } from './RandomizerCard'

const itemValidator = T.object({
	id: T.string,
	source: T.string,
	title: T.string,
	creator: T.string,
	year: T.string,
	cover: T.string,
	stamps: T.arrayOf(T.object({ kind: T.literalEnum(...STAMP_KINDS), date: T.string })),
})

const pickValidator = T.object({ source: T.string, id: T.string })

const versions = createShapePropsMigrationIds(RANDOMIZER_TYPE, { OneSource: 1 })

/** Header, the square window, two rows of tiles, the button and the last picks, at the default width. */
export const RANDOMIZER_MIN_HEIGHT = 520

/**
 * A randomizer: a card that lands on something at random with a split-flap shuffle (DARK-6, design 1B
 * "Departure Board", stamps 2B "Postmarks"), from whatever it is given to shuffle (DARK-7): a list
 * typed into it, or another extension's source, such as a feed's videos.
 *
 * The typed list and the stamps live in the card's own props rather than on the board as shapes,
 * because the card is the whole of the feature: it can be copied to another board, list and stamps
 * and all. A source's entries are the source's, read each time.
 */
export const randomizerNodeDefinition: NodeDefinition<RandomizerProps> = {
	type: RANDOMIZER_TYPE,
	label: 'Randomizer',
	icon: '⤨',
	toolbarIcon: Shuffle,
	props: {
		source: T.string,
		items: T.arrayOf(itemValidator),
		picks: T.arrayOf(pickValidator),
		autoHeight: T.boolean,
	},
	migrations: createShapePropsMigrationSequence({
		sequence: [
			{
				// The Albums / Films / Books switch went (DARK-7): its three lists become the one typed list.
				id: versions.OneSource,
				up(props) {
					const before = props as ThreeListProps & Record<string, unknown>
					const { source, items, picks } = oneTypedList(before)
					delete before.list
					Object.assign(before, { source, items, picks })
				},
			},
		],
	}),
	defaultProps: () => ({ source: NO_SOURCE, items: [], picks: [], autoHeight: true }),
	defaultSize: { w: 360, h: RANDOMIZER_MIN_HEIGHT },
	autoHeight: { minHeight: RANDOMIZER_MIN_HEIGHT },
	component: RandomizerCard,
	// Double-click opens the list.
	canEdit: true,
	getLabel: () => 'Randomizer',
}
