import { createShapePropsMigrationIds, createShapePropsMigrationSequence, type NodeDefinition } from '@lifeboard/node-kit'
import { T } from '@lifeboard/canvas'
import { ListOrdered } from 'lucide-react'
import { TRACK_TYPE, type TrackProps } from '../board'
import { TRACK_HEIGHT, TRACK_WIDTH } from '../ops'
import { getTrack } from '../syllabus'
import { TrackComponent } from './TrackComponent'

export { TRACK_WIDTH } from '../ops'

const versions = createShapePropsMigrationIds(TRACK_TYPE, { VaultTracks: 1 })

/**
 * A list: one vault track as a full outline, in reading order (docs/skill-tree-plan.md, "Tracks").
 * Its height is yours to set; double-click to scroll inside it.
 */
export const trackNodeDefinition: NodeDefinition<TrackProps> = {
	type: TRACK_TYPE,
	label: 'Track',
	icon: '☰',
	toolbarIcon: ListOrdered,
	props: {
		trackId: T.string,
		open: T.string,
	},
	migrations: createShapePropsMigrationSequence({
		sequence: [
			{
				// Tracks moved into the vault: a list keeps only which track it shows, and how it is folded.
				id: versions.VaultTracks,
				up(props) {
					for (const key of ['name', 'goal', 'state', 'order', 'defaultTags', 'autoHeight']) delete props[key]
					props.open = ''
				},
			},
		],
	}),
	defaultProps: () => ({ trackId: '', open: '' }),
	defaultSize: { w: TRACK_WIDTH, h: TRACK_HEIGHT },
	component: TrackComponent,
	canEdit: true,
	canScroll: true,
	getLabel: (shape) => getTrack(shape.props.trackId)?.name || undefined,
}
