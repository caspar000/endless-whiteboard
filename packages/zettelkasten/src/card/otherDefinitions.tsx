import { createShapePropsMigrationSequence, type NodeComponentProps, type NodeDefinition } from '@lifeboard/node-kit'
import { T } from '@lifeboard/canvas'
import { BookOpenText, ListTree } from 'lucide-react'
import { INDEX_TYPE, SOURCE_TYPE, type SourceProps, type SourceShape } from '../box'
import { CARD_H, CARD_W } from '../layout'
import { setFilling, showCard } from '../stack/state'
import { IndexFace } from './IndexFace'
import { SourceFace, sourceLabelOf } from './SourceFace'

/**
 * The box's other two cards, which are laid out and pinned like its notes (definition.tsx): a source,
 * and the index. Neither is offered anywhere: a source is added from a note's **+** or ⌘K, and a box
 * has exactly one index, made with it.
 */
const boxCard = {
	defaultSize: { w: CARD_W, h: CARD_H },
	pinned: true,
	resizable: false,
	clip: false,
	offered: false,
	// Not `canLeavePage`: the index is all other cards' keywords, and a source says who cites it.
	// Required from v1 even when empty (§7).
	migrations: createShapePropsMigrationSequence({ sequence: [] }),
} as const

export const sourceDefinition: NodeDefinition<SourceProps> = {
	...boxCard,
	type: SOURCE_TYPE,
	label: 'Source',
	icon: '📚',
	toolbarIcon: BookOpenText,
	props: { zid: T.string, author: T.string, title: T.string, year: T.string, note: T.string },
	defaultProps: () => ({ zid: '', author: '', title: '', year: '', note: '' }),
	component: ({ shape }: NodeComponentProps<SourceProps>) => <SourceFace shape={shape as unknown as SourceShape} />,
	// Filled in on the stack's card, where its fields have room: a double-click on the table opens it there.
	onDoubleClick: ({ editor, shape }) => {
		const zid = (shape.props as SourceProps).zid
		showCard(editor, zid)
		setFilling(editor, zid)
		return true
	},
	getLabel: (shape) => `${shape.props.zid} ${sourceLabelOf(shape.props)}`.trim(),
}

export const indexDefinition: NodeDefinition<Record<string, never>> = {
	...boxCard,
	type: INDEX_TYPE,
	label: 'Index',
	icon: '🗂',
	toolbarIcon: ListTree,
	props: {},
	defaultProps: () => ({}),
	component: () => <IndexFace />,
	getLabel: () => 'Index',
}
