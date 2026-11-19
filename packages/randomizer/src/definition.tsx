import { T } from '@lifeboard/canvas'
import { createShapePropsMigrationSequence, type NodeDefinition } from '@lifeboard/node-kit'
import { Shuffle } from 'lucide-react'
import { LIST_IDS, STAMP_KINDS } from './model'
import { RANDOMIZER_TYPE, type RandomizerProps } from './props'
import { RandomizerCard } from './RandomizerCard'

const listValidator = T.literalEnum(...LIST_IDS)

const itemValidator = T.object({
	id: T.string,
	list: listValidator,
	title: T.string,
	creator: T.string,
	year: T.string,
	cover: T.string,
	stamps: T.arrayOf(T.object({ kind: T.literalEnum(...STAMP_KINDS), date: T.string })),
})

const pickValidator = T.object({ list: listValidator, id: T.string })

/** Header, the square window, two rows of tiles, the button and the last picks, at the default width. */
export const RANDOMIZER_MIN_HEIGHT = 520

/**
 * A randomizer: a card that holds lists of albums, films and books, and lands on one of them at
 * random with a split-flap shuffle (DARK-6, design 1B "Departure Board", stamps 2B "Postmarks").
 *
 * The lists live in the card's own props rather than on the board as shapes, because the card is the
 * whole of the feature: it can be copied to another board, lists and stamps and all.
 */
export const randomizerNodeDefinition: NodeDefinition<RandomizerProps> = {
	type: RANDOMIZER_TYPE,
	label: 'Randomizer',
	icon: '⤨',
	toolbarIcon: Shuffle,
	props: {
		list: listValidator,
		items: T.arrayOf(itemValidator),
		picks: T.arrayOf(pickValidator),
		autoHeight: T.boolean,
	},
	// Required from v1 even when empty: the sequence has to exist before it has anything in it.
	migrations: createShapePropsMigrationSequence({ sequence: [] }),
	defaultProps: () => ({ list: 'albums', items: [], picks: [], autoHeight: true }),
	defaultSize: { w: 360, h: RANDOMIZER_MIN_HEIGHT },
	autoHeight: { minHeight: RANDOMIZER_MIN_HEIGHT },
	component: RandomizerCard,
	// Double-click opens the list.
	canEdit: true,
	getLabel: () => 'Randomizer',
}
