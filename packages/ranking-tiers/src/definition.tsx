import { T } from '@lifeboard/canvas'
import { createShapePropsMigrationSequence, type NodeDefinition } from '@lifeboard/node-kit'
import { ListOrdered } from 'lucide-react'
import { randomId } from './model'
import { RANKING_TYPE, type RankingProps } from './props'
import { RankingCard } from './RankingCard'

/** The header and one band, at the default width. */
export const RANKING_MIN_HEIGHT = 220

/**
 * A Ranking Tiers card (DARK-11, design 2B "Banded rows, mixed source"): the items of any source,
 * sorted into tiers. The ranking itself is vault data, so a randomizer anywhere can draw from it; the
 * card holds only which ranking it shows.
 */
export const rankingNodeDefinition: NodeDefinition<RankingProps> = {
	type: RANKING_TYPE,
	label: 'Ranking tiers',
	icon: '≡',
	toolbarIcon: ListOrdered,
	props: {
		rankingId: T.string,
		autoHeight: T.boolean,
	},
	migrations: createShapePropsMigrationSequence({ sequence: [] }),
	defaultProps: () => ({ rankingId: randomId(), autoHeight: true }),
	defaultSize: { w: 620, h: RANKING_MIN_HEIGHT },
	autoHeight: { minHeight: RANKING_MIN_HEIGHT },
	component: RankingCard,
	// Double-click opens what it ranks.
	canEdit: true,
	getLabel: () => 'Ranking tiers',
}
