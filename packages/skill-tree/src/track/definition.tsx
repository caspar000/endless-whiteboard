import { createShapePropsMigrationSequence, type NodeDefinition } from '@lifeboard/node-kit'
import { T } from '@lifeboard/canvas'
import { ListOrdered } from 'lucide-react'
import { TRACK_TYPE, type TrackProps } from '../board'
import { makeItemId } from '../model'
import { TrackComponent } from './TrackComponent'

export const TRACK_WIDTH = 360
const TRACK_MIN_HEIGHT = 120

/**
 * An ordered syllabus: the items to go through, in order, with the next one lit
 * (docs/skill-tree-plan.md, "Tracks"). The track owns the order, so one item can sit in two tracks.
 */
export const trackNodeDefinition: NodeDefinition<TrackProps> = {
	type: TRACK_TYPE,
	label: 'Track',
	icon: '☰',
	toolbarIcon: ListOrdered,
	props: {
		trackId: T.string,
		name: T.string,
		goal: T.string,
		state: T.string,
		order: T.string,
		defaultTags: T.string,
		autoHeight: T.boolean,
	},
	// Empty for now; the sequence exists from day one so the first migration is a one-line change.
	migrations: createShapePropsMigrationSequence({ sequence: [] }),
	defaultProps: () => ({
		trackId: '',
		name: 'New track',
		goal: '',
		state: 'notStarted',
		order: '',
		defaultTags: '',
		autoHeight: true,
	}),
	onCreate: ({ shape }) => (shape.props.trackId ? null : { trackId: makeItemId(shape.props.name || 'track', 'track/') }),
	defaultSize: { w: TRACK_WIDTH, h: TRACK_MIN_HEIGHT },
	autoHeight: { minHeight: TRACK_MIN_HEIGHT },
	component: TrackComponent,
	canEdit: true,
	getLabel: (shape) => shape.props.name || undefined,
}
