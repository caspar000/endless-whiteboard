import { createShapePropsMigrationIds, createShapePropsMigrationSequence, type NodeDefinition } from '@lifeboard/node-kit'
import { T } from '@lifeboard/canvas'
import { CircleDot } from 'lucide-react'
import { ENTRY_TYPE, type EntryProps } from '../board'
import { getItem } from '../syllabus'
import { EntryComponent } from './EntryComponent'

/** A disc the size a skill node used to be, its name inside, so a line meets its middle. */
export const ENTRY_SIZE = { w: 110, h: 110 }
/** A smaller disc with its title below it: the box holds both. */
export const WORK_SIZE = { w: 120, h: 100 }
export const WORK_DISC = 60
/** Where a line to a work ends: the middle of its disc, as a fraction of the box. */
export const WORK_ANCHOR = { x: 0.5, y: WORK_DISC / 2 / WORK_SIZE.h }

const versions = createShapePropsMigrationIds(ENTRY_TYPE, { RoundWorks: 1 })

/**
 * An entry or a work in a tree view. Put there by the view (treeSync.ts), not by hand, so it has no
 * dock button.
 */
export const entryNodeDefinition: NodeDefinition<EntryProps> = {
	type: ENTRY_TYPE,
	label: 'Tree entry',
	icon: '•',
	toolbarIcon: CircleDot,
	props: { itemId: T.string, treeId: T.string, variant: T.string },
	migrations: createShapePropsMigrationSequence({
		sequence: [
			{
				// A work became a disc with its title below (docs/skill-tree-layout-plan.md).
				id: versions.RoundWorks,
				up(props) {
					if (props.variant !== 'work') return
					props.w = WORK_SIZE.w
					props.h = WORK_SIZE.h
				},
			},
		],
	}),
	defaultProps: () => ({ itemId: '', treeId: '', variant: 'entry' }),
	defaultSize: ENTRY_SIZE,
	// Not something to make by hand: the view puts entries in. Kept out of the dock and the create
	// menu the way a retired type is.
	deprecated: true,
	// Part of the maze's locked structure, with its skill node.
	pinned: true,
	component: EntryComponent,
	gpu: true,
	// An entry is a disc; a work a smaller disc with its title below, which still takes a click.
	outline: (shape) =>
		shape.props.variant === 'work'
			? { cx: shape.props.w / 2, cy: WORK_DISC / 2, r: WORK_DISC / 2, rest: { x: 0, y: WORK_DISC, w: shape.props.w, h: Math.max(1, shape.props.h - WORK_DISC) } }
			: { cx: shape.props.w / 2, cy: shape.props.h / 2, r: Math.min(shape.props.w, shape.props.h) / 2 },
	getLabel: (shape) => getItem(shape.props.itemId)?.title || undefined,
}
