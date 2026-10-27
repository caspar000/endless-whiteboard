import {
	RichText,
	isEmptyRichText,
	renderHtmlFromRichText,
	stopEventPropagation,
	useEditor,
	useValue,
	type TLRichText,
} from '@lifeboard/canvas'
import { useMemo, useRef, type ReactNode } from 'react'
import { boxOrder, type CardShape, type ChipKind } from '../box'
import { goToCard } from '../go'
import { LINK_PATTERN } from '../links'
import { useFitText } from './fit'
import { NoteFoot } from './Foot'

/**
 * The text's links (`[[25a]]`, links.ts) as chips, in the HTML a card draws when it isn't being
 * written on. A link to a number the box doesn't have is drawn struck through.
 */
function withLinkChips(html: string, has: (zid: string) => boolean): string {
	return html.replace(LINK_PATTERN, (_whole, raw: string) => {
		const zid = raw.toLowerCase()
		const missing = has(zid) ? '' : ' lb-zlink--missing'
		return `<span class="lb-zlink${missing}" data-zid="${zid}" role="link" tabindex="-1">${zid}</span>`
	})
}

/** The card's text drawn, not edited: the sticky note's HTML, with its links as chips. */
function StaticText({ richText }: { richText: TLRichText }) {
	const editor = useEditor()
	const known = useValue('lifeboard:zettel-known', () => boxOrder(editor).map((entry) => entry.zid).join(' '), [editor])
	const html = useMemo(() => {
		const ids = new Set(known.split(' '))
		return withLinkChips(renderHtmlFromRichText(richText, editor.getTextExtensions()), (zid) => ids.has(zid))
	}, [richText, known, editor])
	const chipAt = (target: EventTarget) => (target as HTMLElement).closest<HTMLElement>('.lb-zlink')
	return (
		<div
			className="lb-zcard__text tl-rich-text"
			dir="auto"
			dangerouslySetInnerHTML={{ __html: html }}
			// A link goes where it says, in the stack and on the table alike, instead of starting to write.
			onPointerDown={(event) => {
				if (chipAt(event.target)) stopEventPropagation(event)
			}}
			onClick={(event) => {
				const chip = chipAt(event.target)
				if (!chip?.dataset.zid) return
				event.stopPropagation()
				goToCard(editor, chip.dataset.zid)
			}}
		/>
	)
}

/**
 * The paper every card in a box is drawn on, wherever it is drawn: a 5 × 8 card, as the board draws a
 * white sticky note (its paper, edge, shadow and handwritten face). `id` is what goes in the corner.
 */
export function CardPaper({
	id,
	editing = false,
	className,
	children,
}: {
	id: string
	editing?: boolean
	className?: string
	children: ReactNode
}) {
	return (
		// The frame is what the card's type and padding are measured against (`cqw`, styles.css). The
		// shadow is the sticky note's own (`tl-note__shadow`), so a card lies on the board as a note does.
		<div className="lb-zcard-frame">
			<div className="tl-note__shadow" />
			<div className={className ? `lb-zcard ${className}` : 'lb-zcard'} data-editing={editing || undefined}>
				<div className="lb-zcard__id">{id}</div>
				{children}
			</div>
		</div>
	)
}

/**
 * One note as it looks everywhere: in the stack, and on the table (the canvas).
 *
 * `live` is the place allowed to edit the note: only one may be, or two editors would fight over one
 * note. The stack's front card while the stack is open, the canvas otherwise. The sticky note's own
 * rich-text editor draws the text while it is being written on; otherwise the card draws it itself,
 * so that its links (`[[25a]]`) can be chips.
 *
 * A note longer than its card is written smaller until it fits (fit.ts), rather than scrolling.
 */
export function CardFace({
	shape,
	live,
	editing = false,
	add,
	onRemove,
}: {
	shape: CardShape
	live: boolean
	editing?: boolean
	/** The stack's **+**, in the footer of the card in front. */
	add?: ReactNode
	onRemove?: (kind: ChipKind, value: string) => void
}) {
	const { zid, richText } = shape.props
	const writing = live && editing
	const empty = isEmptyRichText(richText) && !writing
	const body = useRef<HTMLDivElement>(null)
	useFitText(body, [richText, writing])
	return (
		<CardPaper id={zid} editing={editing}>
			<div className="lb-zcard__body" ref={body}>
				{empty ? (
					<p className="lb-zcard__empty">Empty note</p>
				) : writing ? (
					<RichText shapeId={shape.id} shapeType={shape.type} richText={richText} className="lb-zcard__text" />
				) : (
					<StaticText richText={richText} />
				)}
			</div>
			<NoteFoot shape={shape} add={add} onRemove={onRemove} />
		</CardPaper>
	)
}
