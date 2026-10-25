import { createShapePropsMigrationIds, createShapePropsMigrationSequence, type NodeDefinition } from '@lifeboard/node-kit'
import { T } from '@lifeboard/canvas'
import { ListChecks } from 'lucide-react'
import { ITEM_TYPE, type SkillItemProps } from '../board'
import { makeItemId } from '../model'
import { ITEM_HEIGHT, ITEM_WIDTH } from '../ops'
import { getItem, putItems } from '../syllabus'
import { ItemComponent } from './ItemComponent'

const versions = createShapePropsMigrationIds(ITEM_TYPE, { VaultItems: 1 })

/**
 * A card for one syllabus item: read Sophocles, watch a production, build an exercise
 * (docs/skill-tree-plan.md, "Items"). The item lives in the vault; the card shows it, its works as a
 * checklist, and ticks it. Deleting a card deletes nothing.
 */
export const itemNodeDefinition: NodeDefinition<SkillItemProps> = {
	type: ITEM_TYPE,
	label: 'Syllabus item',
	icon: '☑',
	toolbarIcon: ListChecks,
	props: {
		itemId: T.string,
		autoHeight: T.boolean,
	},
	migrations: createShapePropsMigrationSequence({
		sequence: [
			{
				// Items moved into the vault: a card keeps only which item it shows.
				id: versions.VaultItems,
				up(props) {
					for (const key of ['title', 'parentId', 'core', 'childRule', 'collapsed', 'tags']) delete props[key]
				},
			},
		],
	}),
	defaultProps: () => ({ itemId: '', autoHeight: true }),
	/*
	 * A card made from the dock or ⌘K makes a new item in the vault. A card that arrives with an id (put
	 * on the board for an item, pasted) shows that item and never replaces it.
	 */
	onCreate: ({ shape }) => {
		if (shape.props.itemId && getItem(shape.props.itemId)) return null
		const itemId = shape.props.itemId || makeItemId('item')
		putItems([{ itemId, title: 'Untitled item', kind: '', medium: '', tags: [], core: false, childRule: 'core', parent: '', children: [], done: false, doneAt: '', draft: '' }])
		return shape.props.itemId ? null : { itemId }
	},
	defaultSize: { w: ITEM_WIDTH, h: ITEM_HEIGHT },
	autoHeight: { minHeight: ITEM_HEIGHT },
	component: ItemComponent,
	canEdit: true,
	getLabel: (shape) => getItem(shape.props.itemId)?.title || undefined,
}
