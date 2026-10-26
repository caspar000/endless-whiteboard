import { RichText, isEmptyRichText, renderHtmlFromRichText, useEditor } from '@lifeboard/canvas'
import type { CardShape } from '../box'

/**
 * One index card as it looks everywhere: in the stack, and on the table (the canvas).
 *
 * `live` draws the text with the sticky note's own rich-text component, which turns into the editor
 * while the card is being edited. Only one place may be live for a card at a time, or two editors
 * would fight over one note: the stack's front card while the stack is open, the canvas otherwise.
 */
export function CardFace({ shape, live, editing = false }: { shape: CardShape; live: boolean; editing?: boolean }) {
	const editor = useEditor()
	const { zid, richText } = shape.props
	const empty = isEmptyRichText(richText) && !editing
	return (
		<div className="lb-zcard" data-editing={editing || undefined}>
			<div className="lb-zcard__id">{zid}</div>
			<div className="lb-zcard__body">
				{empty ? (
					<p className="lb-zcard__empty">Empty note</p>
				) : live ? (
					<RichText shapeId={shape.id} shapeType={shape.type} richText={richText} className="lb-zcard__text" />
				) : (
					<div
						className="lb-zcard__text tl-rich-text"
						dir="auto"
						dangerouslySetInnerHTML={{ __html: renderHtmlFromRichText(richText, editor.getTextExtensions()) }}
					/>
				)}
			</div>
		</div>
	)
}
