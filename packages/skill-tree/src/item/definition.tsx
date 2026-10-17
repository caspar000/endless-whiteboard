import { createShapePropsMigrationSequence, type NodeDefinition } from '@lifeboard/node-kit'
import { T } from '@lifeboard/canvas'
import { ListChecks } from 'lucide-react'
import { ITEM_TYPE, type SkillItemProps } from '../board'
import { makeItemId } from '../model'
import { ITEM_HEIGHT, ITEM_WIDTH } from '../ops'
import { ItemComponent } from './ItemComponent'

/**
 * One thing to do in a syllabus: read Sophocles, watch a production, build an exercise
 * (docs/skill-tree-plan.md, "Items"). Its children are items too, so Plato's dialogues and a unit's
 * steps are the same shape as the item they belong to.
 */
export const itemNodeDefinition: NodeDefinition<SkillItemProps> = {
	type: ITEM_TYPE,
	label: 'Syllabus item',
	icon: '☑',
	toolbarIcon: ListChecks,
	props: {
		itemId: T.string,
		title: T.string,
		parentId: T.string,
		core: T.boolean,
		childRule: T.string,
		collapsed: T.boolean,
		tags: T.string,
		autoHeight: T.boolean,
	},
	// Empty for now; the sequence exists from day one so the first migration is a one-line change.
	migrations: createShapePropsMigrationSequence({ sequence: [] }),
	defaultProps: () => ({
		itemId: '',
		title: '',
		parentId: '',
		core: false,
		childRule: 'core',
		collapsed: false,
		tags: '',
		autoHeight: true,
	}),
	/*
	 * Mints the global id for an item made from the dock or ⌘K. Never overwrites one: a pasted or
	 * imported item arrives carrying its id, and keeping it is what keeps its history.
	 */
	onCreate: ({ shape }) => (shape.props.itemId ? null : { itemId: makeItemId(shape.props.title || 'item') }),
	defaultSize: { w: ITEM_WIDTH, h: ITEM_HEIGHT },
	autoHeight: { minHeight: ITEM_HEIGHT },
	component: ItemComponent,
	canEdit: true,
	getLabel: (shape) => shape.props.title || undefined,
}
