import { createShapePropsMigrationSequence, type NodeDefinition } from '@lifeboard/node-kit'
import { T } from '@lifeboard/canvas'
import { CircleDot } from 'lucide-react'
import { ENTRY_TYPE, type EntryProps } from '../board'
import { getItem } from '../syllabus'
import { focusOn } from '../tree/focus'
import { EntryComponent } from './EntryComponent'

/** A disc the size a skill node used to be, its name inside, so a line meets its middle. */
export const ENTRY_SIZE = { w: 110, h: 110 }
export const WORK_SIZE = { w: 180, h: 26 }

/**
 * An entry or a work in a tree view. Put there by the view (treeSync.ts), not by hand, so it has no
 * dock button; double-click focuses the tree on it.
 */
export const entryNodeDefinition: NodeDefinition<EntryProps> = {
	type: ENTRY_TYPE,
	label: 'Tree entry',
	icon: '•',
	toolbarIcon: CircleDot,
	props: { itemId: T.string, treeId: T.string, variant: T.string },
	// Empty for now; the sequence exists from day one so the first migration is a one-line change.
	migrations: createShapePropsMigrationSequence({ sequence: [] }),
	defaultProps: () => ({ itemId: '', treeId: '', variant: 'entry' }),
	defaultSize: ENTRY_SIZE,
	// Not something to make by hand: the view puts entries in. Kept out of the dock and the create
	// menu the way a retired type is.
	deprecated: true,
	component: EntryComponent,
	onDoubleClick: ({ editor, shape }) => focusOn(editor, (shape.props as EntryProps).itemId),
	getLabel: (shape) => getItem(shape.props.itemId)?.title || undefined,
}
