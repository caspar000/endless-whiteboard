import {
	TLArrowShape,
	TLRichText,
	TLShapeId,
	VecLike,
	isEmptyRichText,
	useEditor,
	useValue,
} from '@lifeboard/canvas-editor'
import * as React from 'react'
import { RichText } from '../../shared/RichText'
import { ARROW_LABEL_FONT_SIZES, TEXT_PROPS } from '../../shared/default-shape-constants'

export const ArrowTextLabel = React.memo(function ArrowTextLabel({
	id,
	richText,
	size,
	font,
	position,
	width,
	labelColor,
}: {
	id: TLShapeId
	richText: TLRichText
	position: VecLike
	width?: number
	labelColor: string
} & Pick<TLArrowShape['props'], 'size' | 'font'>) {
	const editor = useEditor()
	const isEditing = useValue('isEditing', () => editor.getEditingShapeId() === id, [editor, id])
	const isEmpty = isEmptyRichText(richText)

	if (!isEditing && isEmpty) {
		return null
	}

	return (
		<div
			className="tl-arrow-label"
			data-font={font}
			data-align={'center'}
			data-hastext={!isEmpty}
			data-isediting={isEditing}
			style={{
				textAlign: 'center',
				fontSize: ARROW_LABEL_FONT_SIZES[size],
				lineHeight: ARROW_LABEL_FONT_SIZES[size] * TEXT_PROPS.lineHeight + 'px',
				transform: `translate(${position.x}px, ${position.y}px)`,
				color: labelColor,
			}}
		>
			<div className="tl-arrow-label__inner">
				<RichText
					shapeId={id}
					shapeType="arrow"
					richText={richText}
					className="tl-arrow-label__text"
					style={{ width: width ? width : '9px' }}
				/>
			</div>
		</div>
	)
})
