import {
	DefaultFontFamilies,
	Editor,
	Rectangle2d,
	ShapeUtil,
	SvgExportContext,
	renderHtmlFromRichText,
	richTextToPlainText,
	toRichText,
	trimRichText,
	TLNoteShape,
	TLOnEditEndHandler,
	getDefaultColorTheme,
	noteShapeMigrations,
	noteShapeProps,
	toDomPrecision,
} from '@lifeboard/canvas-editor'
import { HyperlinkButton } from '../shared/HyperlinkButton'
import { useDefaultColorTheme } from '../shared/ShapeFill'
import { TextLabel } from '../shared/TextLabel'
import { FONT_FAMILIES, LABEL_FONT_SIZES, TEXT_PROPS } from '../shared/default-shape-constants'
import { getFontDefForExport } from '../shared/defaultStyleDefs'
import { getTextLabelSvgElement } from '../shared/getTextLabelSvgElement'

const NOTE_SIZE = 200

/** @public */
export class NoteShapeUtil extends ShapeUtil<TLNoteShape> {
	static override type = 'note' as const
	static override props = noteShapeProps
	static override migrations = noteShapeMigrations

	override canEdit = () => true
	override hideResizeHandles = () => true
	override hideSelectionBoundsFg = () => true

	getDefaultProps(): TLNoteShape['props'] {
		return {
			color: 'black',
			labelColor: 'black',
			size: 'm',
			richText: toRichText(''),
			font: 'draw',
			align: 'middle',
			verticalAlign: 'middle',
			growY: 0,
			url: '',
			fontSizeAdjustment: 0,
			scale: 1,
			textLastEditedBy: null,
		}
	}

	getHeight(shape: TLNoteShape) {
		return NOTE_SIZE + shape.props.growY
	}

	getGeometry(shape: TLNoteShape) {
		const height = this.getHeight(shape)
		return new Rectangle2d({ width: NOTE_SIZE, height, isFilled: true })
	}

	component(shape: TLNoteShape) {
		const {
			id,
			type,
			props: { color, labelColor, font, size, align, richText, verticalAlign },
		} = shape

		// eslint-disable-next-line react-hooks/rules-of-hooks
		const theme = useDefaultColorTheme()

		return (
			<>
				<div
					style={{
						position: 'absolute',
						width: NOTE_SIZE,
						height: this.getHeight(shape),
					}}
				>
					<div
						className="tl-note__container"
						style={{ backgroundColor: theme[color].noteFill }}
					>
						<TextLabel
							id={id}
							type={type}
							font={font}
							size={size}
							align={align}
							verticalAlign={verticalAlign}
							richText={richText}
							labelColor={labelColor}
							wrap
						/>
					</div>
				</div>
				{'url' in shape.props && shape.props.url && (
					<HyperlinkButton url={shape.props.url} zoomLevel={this.editor.getZoomLevel()} />
				)}
			</>
		)
	}

	indicator(shape: TLNoteShape) {
		return (
			<rect
				rx="7"
				width={toDomPrecision(NOTE_SIZE)}
				height={toDomPrecision(this.getHeight(shape))}
			/>
		)
	}

	override toSvg(shape: TLNoteShape, ctx: SvgExportContext) {
		ctx.addExportDef(getFontDefForExport(shape.props.font))
		const theme = getDefaultColorTheme({ isDarkMode: this.editor.user.getIsDarkMode() })
		const bounds = this.editor.getShapeGeometry(shape).bounds

		const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')

		const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
		rect.setAttribute('rx', '10')
		rect.setAttribute('width', NOTE_SIZE.toString())
		rect.setAttribute('height', bounds.height.toString())
		rect.setAttribute('fill', theme[shape.props.color].noteFill)
		g.appendChild(rect)

		const textElm = getTextLabelSvgElement({
			editor: this.editor,
			shape,
			font: DefaultFontFamilies[shape.props.font],
			bounds,
		})

		// The label's own colour (today's `labelColor`), as the canvas draws it.
		textElm.setAttribute('fill', theme[shape.props.labelColor].solid)
		textElm.setAttribute('stroke', 'none')
		g.appendChild(textElm)

		return g
	}

	override onBeforeCreate = (next: TLNoteShape) => {
		return getGrowY(this.editor, next, next.props.growY)
	}

	override onBeforeUpdate = (prev: TLNoteShape, next: TLNoteShape) => {
		if (
			prev.props.richText === next.props.richText &&
			prev.props.font === next.props.font &&
			prev.props.size === next.props.size
		) {
			return
		}

		return getGrowY(this.editor, next, prev.props.growY)
	}

	override getText(shape: TLNoteShape) {
		return richTextToPlainText(shape.props.richText)
	}

	override onEditEnd: TLOnEditEndHandler<TLNoteShape> = (shape) => {
		const richText = trimRichText(shape.props.richText)
		if (richText !== shape.props.richText) {
			this.editor.updateShapes<TLNoteShape>([{ id: shape.id, type: shape.type, props: { richText } }])
		}
	}
}

function getGrowY(editor: Editor, shape: TLNoteShape, prevGrowY = 0) {
	const PADDING = 17

	const html = renderHtmlFromRichText(shape.props.richText, editor.getTextExtensions())
	const nextTextSize = editor.textMeasure.measureHtml(html, {
		...TEXT_PROPS,
		fontFamily: FONT_FAMILIES[shape.props.font],
		fontSize: LABEL_FONT_SIZES[shape.props.size],
		maxWidth: NOTE_SIZE - PADDING * 2,
	})

	const nextHeight = nextTextSize.h + PADDING * 2

	let growY: number | null = null

	if (nextHeight > NOTE_SIZE) {
		growY = nextHeight - NOTE_SIZE
	} else {
		if (prevGrowY) {
			growY = 0
		}
	}

	if (growY !== null) {
		return {
			...shape,
			props: {
				...shape.props,
				growY,
			},
		}
	}
}
