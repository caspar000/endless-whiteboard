import {
	createShapePropsMigrationSequence,
	getBoardBridge,
	type NodeComponentProps,
	type NodeDefinition,
} from '@lifeboard/node-kit'
import {
	RichText,
	T,
	atom,
	isEmptyRichText,
	renderHtmlFromRichText,
	richTextValidator,
	stopEventPropagation,
	toRichText,
	useValue,
	type Editor,
	type TLRichText,
	type TLShape,
	type TLShapeId,
} from '@lifeboard/canvas'
import { NotebookText } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { isCard } from '../box'
import { CardPaper, withLinkChips } from '../card/CardFace'
import { useFitText } from '../card/fit'
import { nameOf } from '../card/text'
import { CARD_H, CARD_W } from '../layout'
import { placeCaret } from '../stack/StackView'
import { showCard } from '../stack/state'
import { boardName, liveBox, reachBox } from './live'

/**
 * A note from a box, shown on an ordinary board (docs/zettelkasten-plan.md, phase 8).
 *
 * The note stays in its box: this card points at it (the box's board and the card's shape id, which
 * never changes, unlike its number) and keeps a copy of its text, so the board still reads when the
 * box isn't open. While the box is mounted the card follows it live and keeps the copy current.
 * Written on here, it writes through to the card in the box: double-clicking mounts the box in a tab
 * behind this one first, if it isn't already.
 */
export const REF_TYPE = 'node.zettelRef'

export interface RefProps {
	/** The box's board id. */
	boxId: string
	/** The note's card in the box, by shape id. */
	cardId: string
	/** Its number when last seen. */
	zid: string
	/** Its text when last seen, and what is edited here. */
	richText: TLRichText
	/** Written here while the box was out of reach: to be taken to the box when it is next mounted. */
	pending: boolean
}

export type RefShape = TLShape & { type: typeof REF_TYPE; props: RefProps & { w: number; h: number } }

export function isRef(shape: { type: string } | null | undefined): shape is RefShape {
	return shape?.type === REF_TYPE
}

/** References being got ready to write on, while their box mounts. */
const reaching = atom<ReadonlySet<string>>('lifeboard:zettel-ref-reaching', new Set())

function setReaching(id: string, on: boolean): void {
	const next = new Set(reaching.get())
	if (on) next.add(id)
	else next.delete(id)
	reaching.set(next)
}

/** Opens the box (switching to it) at a note. */
export async function openInBox(boxId: string, zid: string): Promise<void> {
	const box = await getBoardBridge()?.open(boxId)
	if (box) showCard(box, zid)
}

/** Starts writing on a reference here, once its box is in reach. */
async function writeOnRef(editor: Editor, shape: RefShape): Promise<void> {
	setReaching(shape.id, true)
	try {
		const box = await reachBox(shape.props.boxId)
		if (!box || !isCard(box.getShape(shape.props.cardId as TLShapeId))) return
		editor.select(shape.id)
		editor.setEditingShape(shape.id)
		editor.setCurrentTool('select.editing_shape')
	} finally {
		setReaching(shape.id, false)
	}
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function RefText({ richText, boxId, editor }: { richText: TLRichText; boxId: string; editor: Editor }) {
	const html = useMemo(() => withLinkChips(renderHtmlFromRichText(richText, editor.getTextExtensions()), () => true), [richText, editor])
	return (
		<div
			className="lb-zcard__text tl-rich-text"
			dir="auto"
			dangerouslySetInnerHTML={{ __html: html }}
			onPointerDown={(event) => {
				if ((event.target as HTMLElement).closest('.lb-zlink')) stopEventPropagation(event)
			}}
			onClick={(event) => {
				const zid = (event.target as HTMLElement).closest<HTMLElement>('.lb-zlink')?.dataset.zid
				if (!zid) return
				event.stopPropagation()
				void openInBox(boxId, zid)
			}}
		/>
	)
}

function RefCard({ shape: raw, isEditing, editor }: NodeComponentProps<RefProps>) {
	const shape = raw as unknown as RefShape
	const { boxId, cardId, zid, richText, pending } = shape.props
	const box = useValue('lifeboard:zettel-ref-box', () => liveBox(boxId), [boxId])
	const card = useValue(
		'lifeboard:zettel-ref-card',
		() => {
			const found = box?.getShape(cardId as TLShapeId)
			return isCard(found) ? found : null
		},
		[box, cardId]
	)
	const opening = useValue('lifeboard:zettel-ref-opening', () => reaching.get().has(shape.id), [shape.id])
	const [name, setName] = useState<string | null>(null)
	useEffect(() => {
		let cancelled = false
		void boardName(boxId).then((found) => !cancelled && setName(found))
		return () => {
			cancelled = true
		}
	}, [boxId])

	// With the box in reach: what was written here while it wasn't goes to the box; otherwise the copy
	// here catches up with the box. Not while it is being written on, when this card is the source.
	useEffect(() => {
		if (!box || !card || isEditing) return
		if (pending) {
			box.markHistoryStoppingPoint('edit from another board')
			box.updateShape({ id: card.id, type: card.type, props: { richText } } as never)
			editor.run(() => editor.updateShape({ id: shape.id, type: REF_TYPE, props: { pending: false } } as never), { history: 'ignore' })
			return
		}
		if (card.props.zid !== zid || !same(card.props.richText, richText)) {
			editor.run(
				() => editor.updateShape({ id: shape.id, type: REF_TYPE, props: { zid: card.props.zid, richText: card.props.richText } } as never),
				{ history: 'ignore' }
			)
		}
	}, [box, card, isEditing, pending, richText, zid, editor, shape.id])

	useEffect(() => {
		if (isEditing) placeCaret(editor)
	}, [editor, isEditing])

	const gone = box !== null && card === null
	const shown = isEditing || !card ? richText : card.props.richText
	const body = useRef<HTMLDivElement>(null)
	useFitText(body, [shown, isEditing])

	return (
		<CardPaper id={card?.props.zid ?? zid} editing={isEditing} className="lb-zcard--ref">
			<div className="lb-zcard__body" ref={body}>
				{isEmptyRichText(shown) && !isEditing ? (
					<p className="lb-zcard__empty">Empty note</p>
				) : isEditing ? (
					<RichText shapeId={shape.id} shapeType={shape.type} richText={richText} className="lb-zcard__text" />
				) : (
					<RefText richText={shown} boxId={boxId} editor={editor} />
				)}
			</div>
			<div className="lb-zcard__foot">
				<div className="lb-zcard__from">
					{gone ? (
						'Taken out of its box.'
					) : (
						<>
							In{' '}
							<button
								type="button"
								className="lb-zlink"
								title="Open it in its box"
								onPointerDown={stopEventPropagation}
								onClick={(event) => {
									event.stopPropagation()
									void openInBox(boxId, card?.props.zid ?? zid)
								}}
							>
								{name ?? 'its box'}
							</button>
							{opening ? ' · opening its box…' : !box ? ' · as it was when its box was last open' : ''}
						</>
					)}
				</div>
			</div>
		</CardPaper>
	)
}

export const refDefinition: NodeDefinition<RefProps> = {
	type: REF_TYPE,
	label: 'Note from a box',
	icon: '🗂',
	toolbarIcon: NotebookText,
	props: { boxId: T.string, cardId: T.string, zid: T.string, richText: richTextValidator, pending: T.boolean },
	// Required from v1 even when empty (§7).
	migrations: createShapePropsMigrationSequence({ sequence: [] }),
	defaultProps: () => ({ boxId: '', cardId: '', zid: '', richText: toRichText(''), pending: false }),
	defaultSize: { w: CARD_W, h: CARD_H },
	component: RefCard,
	canEdit: true,
	canScroll: true,
	resizable: false,
	clip: false,
	// Made by putting a box's note on a board, or by pasting one; a blank one would point at nothing.
	offered: false,
	// Writing on it needs its box: mounted behind this tab first, when it isn't already.
	onDoubleClick: ({ editor, shape }) => {
		if (!isRef(shape)) return false
		const box = liveBox(shape.props.boxId)
		if (box && isCard(box.getShape(shape.props.cardId as TLShapeId))) return false
		if (box) return true
		void writeOnRef(editor, shape)
		return true
	},
	getLabel: (shape) => `${shape.props.zid} ${nameOf(shape.props.richText)}`.trim(),
}
