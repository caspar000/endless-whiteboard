import {
	createShapePropsMigrationSequence,
	type NodeComponentProps,
	type NodeDefinition,
} from '@lifeboard/node-kit'
import { T, richTextValidator, toRichText, useValue } from '@lifeboard/canvas'
import { NotebookText } from 'lucide-react'
import { useEffect } from 'react'
import { CARD_TYPE, type CardProps, type CardShape } from '../box'
import { CARD_H, CARD_W } from '../layout'
import { placeCaret } from '../stack/StackView'
import { isStackOpen } from '../stack/state'
import { CardFace } from './CardFace'
import { nameOf } from './text'

function CardOnCanvas({ shape, isEditing, editor }: NodeComponentProps<CardProps>) {
	// While the stack is open it has the live copy of the text (CardFace explains why only one may).
	const stackOpen = useValue('lifeboard:zettel-stack-open', () => isStackOpen(editor), [editor])
	const writing = isEditing && !stackOpen
	// Double-clicking a card on the table starts at the end of its text rather than selecting all of it.
	useEffect(() => {
		if (writing) placeCaret(editor)
	}, [editor, writing])
	return <CardFace shape={shape as unknown as CardShape} live={!stackOpen} editing={writing} />
}

/**
 * One note in a Zettelkasten box.
 *
 * Made only by placing it (box.ts, `placeNote`): its id is where it sits in the box, so a card dropped
 * loose from the dock would mean nothing. Hence `offered: false`. Pinned and the same size as every
 * other card, because the box lays its cards out itself (layout.ts).
 */
export const cardDefinition: NodeDefinition<CardProps> = {
	type: CARD_TYPE,
	label: 'Zettel',
	icon: '🗂',
	toolbarIcon: NotebookText,
	props: {
		zid: T.string,
		richText: richTextValidator,
	},
	// Required from v1 even when empty (§7).
	migrations: createShapePropsMigrationSequence({ sequence: [] }),
	defaultProps: () => ({ zid: '', richText: toRichText('') }),
	defaultSize: { w: CARD_W, h: CARD_H },
	component: CardOnCanvas,
	canEdit: true,
	// The wheel scrolls a long note while it is being written, instead of zooming the table.
	canScroll: true,
	pinned: true,
	resizable: false,
	// The sticky note's shadow falls below the card; the paper clips its own text (`.lb-zcard`).
	clip: false,
	offered: false,
	// Draws nothing but its own record when it isn't being edited.
	canLeavePage: true,
	getLabel: (shape) => `${shape.props.zid} ${nameOf(shape.props.richText)}`.trim(),
}
