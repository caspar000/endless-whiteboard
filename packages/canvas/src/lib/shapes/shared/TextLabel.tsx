import {
	TLRichText,
	Box2d,
	TLDefaultColorStyle,
	TLDefaultFillStyle,
	TLDefaultFontStyle,
	TLDefaultHorizontalAlignStyle,
	TLDefaultSizeStyle,
	TLDefaultVerticalAlignStyle,
	TLShape,
	isEmptyRichText,
	useEditor,
	useValue,
} from '@lifeboard/canvas-editor'
import React from 'react'
import { useDefaultColorTheme } from './ShapeFill'
import { LABEL_FONT_SIZES, TEXT_PROPS } from './default-shape-constants'
import { isLegacyAlign } from './legacyProps'
import { RichText } from './RichText'

export const TextLabel = React.memo(function TextLabel<
	T extends Extract<TLShape, { props: { richText: TLRichText } }>
>({
	id,
	type,
	richText,
	size,
	labelColor,
	font,
	align,
	verticalAlign,
	wrap,
	bounds,
}: {
	id: T['id']
	type: T['type']
	size: TLDefaultSizeStyle
	font: TLDefaultFontStyle
	fill?: TLDefaultFillStyle
	align: TLDefaultHorizontalAlignStyle
	verticalAlign: TLDefaultVerticalAlignStyle
	wrap?: boolean
	richText: TLRichText
	labelColor: TLDefaultColorStyle
	bounds?: Box2d
}) {
	const editor = useEditor()
	const isEditing = useValue('isEditing', () => editor.getEditingShapeId() === id, [editor, id])
	const isEmpty = isEmptyRichText(richText)

	const legacyAlign = isLegacyAlign(align)
	const theme = useDefaultColorTheme()

	if (!isEditing && isEmpty) {
		return null
	}

	return (
		<div
			className="tl-text-label"
			data-font={font}
			data-align={align}
			data-hastext={!isEmpty}
			data-isediting={isEditing}
			data-textwrap={!!wrap}
			style={{
				justifyContent: align === 'middle' || legacyAlign ? 'center' : align,
				alignItems: verticalAlign === 'middle' ? 'center' : verticalAlign,
				...(bounds
					? {
							top: bounds.minY,
							left: bounds.minX,
							width: bounds.width,
							height: bounds.height,
							position: 'absolute',
					  }
					: {}),
			}}
		>
			<div
				className="tl-text-label__inner"
				style={{
					fontSize: LABEL_FONT_SIZES[size],
					lineHeight: LABEL_FONT_SIZES[size] * TEXT_PROPS.lineHeight + 'px',
					minHeight: TEXT_PROPS.lineHeight + 32,
					minWidth: 0,
					color: theme[labelColor].solid,
				}}
			>
				<RichText shapeId={id} shapeType={type} richText={richText} />
			</div>
		</div>
	)
})
