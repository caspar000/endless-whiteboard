import { createShapePropsMigrationSequence, type NodeDefinition } from '@lifeboard/node-kit'
import { T } from '@lifeboard/canvas'
import { Rss } from 'lucide-react'
import { FEED_TYPE, type FeedProps } from '../board'
import { FeedCard } from './FeedCard'

export const feedNodeDefinition: NodeDefinition<FeedProps> = {
	type: FEED_TYPE,
	label: 'Feed',
	icon: '◉',
	toolbarIcon: Rss,
	props: { name: T.string, categoryId: T.string, show: T.string },
	migrations: createShapePropsMigrationSequence({ sequence: [] }),
	defaultProps: () => ({ name: 'My feeds', categoryId: '', show: 'unwatched' }),
	defaultSize: { w: 420, h: 600 },
	component: FeedCard,
	// Double-click to scroll the list and manage sources beside it.
	canEdit: true,
	canScroll: true,
	getLabel: (shape) => shape.props.name,
}
