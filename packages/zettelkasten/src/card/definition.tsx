import {
	createShapePropsMigrationIds,
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
import { isCanvasLive } from '../stack/state'
import { CardFace } from './CardFace'
import { nameOf } from './text'

function CardOnCanvas({ shape, isEditing, editor }: NodeComponentProps<CardProps>) {
	// While the stack or a chain is up it has the live copy of the text (CardFace explains why only one may).
	const live = useValue('lifeboard:zettel-canvas-live', () => isCanvasLive(editor), [editor])
	const writing = isEditing && live
	// Double-clicking a card on the table starts at the end of its text rather than selecting all of it.
	useEffect(() => {
		if (writing) placeCaret(editor)
	}, [editor, writing])
	return <CardFace shape={shape as unknown as CardShape} live={live} editing={writing} />
}

const versions = createShapePropsMigrationIds(CARD_TYPE, { AddChips: 1 })

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
		keywords: T.arrayOf(T.string),
		links: T.arrayOf(T.string),
		cites: T.arrayOf(T.string),
	},
	migrations: createShapePropsMigrationSequence({
		sequence: [
			{
				// Phase 3's footer: a card from before it has none of the three.
				id: versions.AddChips,
				up(props) {
					const p = props as Partial<CardProps>
					p.keywords ??= []
					p.links ??= []
					p.cites ??= []
				},
			},
		],
	}),
	defaultProps: () => ({ zid: '', richText: toRichText(''), keywords: [], links: [], cites: [] }),
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
	// Not `canLeavePage`: its footer shows what other cards say (which link to it, what its chips are
	// called), so it isn't a function of its own record alone.
	getLabel: (shape) => `${shape.props.zid} ${nameOf(shape.props.richText)}`.trim(),
}
