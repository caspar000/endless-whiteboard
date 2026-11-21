import { T } from '@lifeboard/canvas'
import { createShapePropsMigrationSequence, isSourceShapeType, resolveItemSource, sourceKeyOfShape, type NodeDefinition } from '@lifeboard/node-kit'
import { Inbox } from 'lucide-react'
import { BacklogCard } from './BacklogCard'
import { addCollection, randomId } from './model'
import { BACKLOG_TYPE, type BacklogProps } from './props'
import { shapeDropHint, updateBacklog } from './store'

/** The header and the empty state, at the default width. */
export const BACKLOG_MIN_HEIGHT = 200

/**
 * A Backlog card (DARK-11, design 2B, its collections square as in 2A): media you mean to get to,
 * gathered from anywhere. The backlog itself is vault data, so a randomizer or a ranking anywhere can
 * take it; the card holds only which backlog it shows.
 */
export const backlogNodeDefinition: NodeDefinition<BacklogProps> = {
	type: BACKLOG_TYPE,
	label: 'Backlog',
	icon: '☰',
	toolbarIcon: Inbox,
	props: {
		backlogId: T.string,
		autoHeight: T.boolean,
	},
	migrations: createShapePropsMigrationSequence({ sequence: [] }),
	defaultProps: () => ({ backlogId: randomId(), autoHeight: true }),
	defaultSize: { w: 380, h: BACKLOG_MIN_HEIGHT },
	autoHeight: { minHeight: BACKLOG_MIN_HEIGHT },
	component: BacklogCard,
	getLabel: () => 'Backlog',
	/*
	 * A card that stands for a source (a syllabus track's card) dropped on the backlog adds that source,
	 * as one collection, and goes back where it was picked up from: what was dropped is the track, not
	 * the card. Only types some source knows are taken, which also keeps every other shape from ever
	 * becoming the backlog's child.
	 */
	drop: {
		accepts: () => true,
		acceptsType: isSourceShapeType,
		targetAt: ({ editor }) => {
			const key = editor
				.getSelectedShapes()
				.map(sourceKeyOfShape)
				.find((k): k is string => k !== null)
			return key ? { key, values: {} } : null
		},
		hover: ({ shape, target }) => shapeDropHint.set(target ? { shapeId: shape.id, label: resolveItemSource(target.key).name } : null),
		apply: ({ editor, shape, shapes }) => {
			const keys = shapes.map(sourceKeyOfShape).filter((k): k is string => k !== null)
			if (!keys.length) return
			updateBacklog(shape.props.backlogId, (b) => keys.reduceRight((acc, key) => addCollection(acc, key, resolveItemSource(key).source?.label ?? ''), b))
			const origin = editor.inputs.originPagePoint
			const now = editor.inputs.currentPagePoint
			editor.updateShapes(shapes.map((s) => ({ id: s.id, type: s.type, x: s.x - (now.x - origin.x), y: s.y - (now.y - origin.y) })))
		},
	},
}
