import {
	Box2d,
	DefaultFontFamilies,
	Editor,
	exportLabelFromDom,
	Rectangle2d,
	ShapeUtil,
	SvgExportContext,
	TLOnResizeHandler,
	renderHtmlFromRichText,
	richTextToPlainText,
	toRichText,
	trimRichText,
	TLBaseShape,
	TLNoteShape,
	TLNoteShapeProps,
	TLOnEditEndHandler,
	getDefaultColorTheme,
	noteShapeMigrations,
	noteShapeProps,
	toDomPrecision,
} from '@lifeboard/canvas-editor'
import { HyperlinkButton } from '../shared/HyperlinkButton'
import { resizeScaled } from '../shared/resizeScaled'
import { useDefaultColorTheme } from '../shared/ShapeFill'
import { TextLabel } from '../shared/TextLabel'
import { FONT_FAMILIES, LABEL_FONT_SIZES, TEXT_PROPS } from '../shared/default-shape-constants'
import { getFontDefForExport } from '../shared/defaultStyleDefs'
import { getTextLabelSvgElement } from '../shared/getTextLabelSvgElement'
import { SHADOW, STICKY_PAPER, creaseHeight, creasePath, creaseShade, pinPlacement, type NotePaper } from './paper'
import { NotePin, getNotePinSvg, getPinPaint, type PinColor } from './pin'

/** A shape drawn as a note: a sticky note or a pinned note. Their props are the same. */
export type TLNoteLikeShape = TLBaseShape<string, TLNoteShapeProps>

/**
 * What a sticky note and a pinned note share: text that grows the paper, the paper itself, and its
 * export. They differ only in `paper` (./paper.ts).
 *
 * Resizing one scales it, text and all (docs/fork-parity.md B13): the paper keeps its proportions
 * and its text keeps its wrapping, only bigger or smaller. `scale` is that factor; everything else
 * is in the paper's own units.
 *
 * @public
 */
export abstract class BaseNoteShapeUtil<S extends TLNoteLikeShape> extends ShapeUtil<S> {
	abstract readonly paper: NotePaper

	override canEdit = () => true
	override hideSelectionBoundsFg = () => true
	override isAspectRatioLocked = () => true

	getDefaultProps(): S['props'] {
		return {
			color: 'yellow',
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

	/** The paper's height before its scale. */
	getHeight(shape: S) {
		return this.paper.width + shape.props.growY
	}

	getGeometry(shape: S) {
		const { scale } = shape.props
		return new Rectangle2d({
			width: this.paper.width * scale,
			height: this.getHeight(shape) * scale,
			isFilled: true,
		})
	}

	component(shape: S) {
		const {
			id,
			type,
			props: { color, labelColor, font, size, align, richText, verticalAlign },
		} = shape

		// eslint-disable-next-line react-hooks/rules-of-hooks
		const theme = useDefaultColorTheme()
		const fill = theme[color].noteFill
		const { width, crease, pin, textTop } = this.paper
		const pinAt = pinPlacement(width)
		const height = this.getHeight(shape)
		const { scale } = shape.props

		return (
			<>
				<div
					style={{
						position: 'absolute',
						width,
						height,
						...(scale !== 1 && { transform: `scale(${scale})`, transformOrigin: '0 0' }),
					}}
				>
					{/* The paper's look is set out in ./paper.ts. */}
					<div className="tl-note__shadow" />
					<div className="tl-note__container" style={{ backgroundColor: fill }}>
						{crease && (
							<div
								className="tl-note__crease"
								style={{
									height: creaseHeight(width),
									clipPath: `path('${creasePath(width)}')`,
									background: `linear-gradient(${fill}, ${creaseShade(fill)})`,
								}}
							/>
						)}
						<TextLabel
							id={id}
							type={type as 'note' | 'pinned-note'}
							font={font}
							size={size}
							align={align}
							verticalAlign={verticalAlign}
							richText={richText}
							labelColor={labelColor}
							wrap
							{...(textTop ? { bounds: new Box2d(0, textTop, width, height - textTop) } : {})}
						/>
					</div>
					{pin && (
						<NotePin
							className="tl-note__pin"
							width={pinAt.width}
							paint={getPinPaint(pinColorOf(shape), theme)}
							style={{ left: pinAt.x, top: pinAt.y }}
						/>
					)}
				</div>
				{'url' in shape.props && shape.props.url && (
					<HyperlinkButton url={shape.props.url} zoomLevel={this.editor.getZoomLevel()} />
				)}
			</>
		)
	}

	indicator(shape: S) {
		const { scale } = shape.props
		return (
			<rect
				width={toDomPrecision(this.paper.width * scale)}
				height={toDomPrecision(this.getHeight(shape) * scale)}
			/>
		)
	}

	/** The same rectangle for the canvas that draws selected outlines (fork-parity P1). */
	override getIndicatorPath(shape: S) {
		const { scale } = shape.props
		const path = new Path2D()
		path.rect(0, 0, this.paper.width * scale, this.getHeight(shape) * scale)
		return path
	}

	override async toSvg(shape: S, ctx: SvgExportContext) {
		ctx.addExportDef(getFontDefForExport(shape.props.font))
		const theme = getDefaultColorTheme({ isDarkMode: this.editor.user.getIsDarkMode() })
		// Drawn at the paper's own size, and scaled as a whole at the end.
		const bounds = new Box2d(0, 0, this.paper.width, this.getHeight(shape))

		const svg = (tag: string, attributes: Record<string, string | number>) => {
			const el = document.createElementNS('http://www.w3.org/2000/svg', tag)
			for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, String(value))
			return el
		}
		const fill = theme[shape.props.color].noteFill
		const height = bounds.height
		const { width, crease, pin, textTop } = this.paper
		const g = svg('g', {})

		// The paper, as the canvas draws it (./paper.ts): the shadow under its lower part first.
		ctx.addExportDef({
			key: 'note-shadow',
			getElement: () => {
				const filter = svg('filter', { id: 'note-shadow', x: '-100%', y: '-100%', width: '300%', height: '300%' })
				filter.appendChild(svg('feGaussianBlur', { stdDeviation: SHADOW.blur / 2 }))
				return filter
			},
		})
		g.appendChild(
			svg('ellipse', {
				cx: width * (SHADOW.left + SHADOW.width / 2),
				cy: height * (SHADOW.top + SHADOW.height / 2) + SHADOW.offsetY,
				rx: (width * SHADOW.width) / 2,
				ry: (height * SHADOW.height) / 2,
				fill: `rgba(0, 0, 0, ${SHADOW.opacity})`,
				filter: 'url(#note-shadow)',
			})
		)
		g.appendChild(svg('rect', { width, height, fill }))
		if (crease) {
			const creaseId = `note-crease-${fill.replace(/[^0-9a-z]/gi, '')}`
			ctx.addExportDef({
				key: creaseId,
				getElement: () => {
					const gradient = svg('linearGradient', { id: creaseId, x1: 0, y1: 0, x2: 0, y2: 1 })
					gradient.appendChild(svg('stop', { offset: 0, 'stop-color': fill }))
					gradient.appendChild(svg('stop', { offset: 1, 'stop-color': creaseShade(fill) }))
					return gradient
				},
			})
			g.appendChild(svg('path', { d: creasePath(width), fill: `url(#${creaseId})` }))
		}

		// The label as the canvas shows it, formatting and all; as plain text if it isn't showing.
		const label = await exportLabelFromDom(this.editor, shape, '.tl-text-label', ctx, { bounds })
		if (label) {
			g.appendChild(label)
		} else {
			const textElm = getTextLabelSvgElement({
				editor: this.editor,
				// A pinned note's props are a sticky's, which is all the label reads.
				shape: shape as unknown as TLNoteShape,
				font: DefaultFontFamilies[shape.props.font],
				bounds: textTop ? new Box2d(0, textTop, width, height - textTop) : bounds,
			})
			// The label's own colour (today's `labelColor`), as the canvas draws it.
			textElm.setAttribute('fill', theme[shape.props.labelColor].solid)
			textElm.setAttribute('stroke', 'none')
			g.appendChild(textElm)
		}

		if (pin) {
			const at = pinPlacement(width)
			const pinSvg = getNotePinSvg(getPinPaint(pinColorOf(shape), theme))
			pinSvg.setAttribute('transform', `translate(${at.x} ${at.y}) scale(${at.scale})`)
			g.appendChild(pinSvg)
		}

		if (shape.props.scale !== 1) g.setAttribute('transform', `scale(${shape.props.scale})`)
		return g
	}

	override onBeforeCreate = (next: S) => {
		return getGrowY(this.editor, next, this.paper, next.props.growY)
	}

	override onBeforeUpdate = (prev: S, next: S) => {
		if (
			prev.props.richText === next.props.richText &&
			prev.props.font === next.props.font &&
			prev.props.size === next.props.size
		) {
			return
		}

		return getGrowY(this.editor, next, this.paper, prev.props.growY)
	}

	override getText(shape: S) {
		return richTextToPlainText(shape.props.richText)
	}

	override onEditEnd: TLOnEditEndHandler<S> = (shape) => {
		const richText = trimRichText(shape.props.richText)
		if (richText !== shape.props.richText) {
			this.editor.updateShapes([{ id: shape.id, type: shape.type, props: { richText } }])
		}
	}
}

/** @public */
export class NoteShapeUtil extends BaseNoteShapeUtil<TLNoteShape> {
	static override type = 'note' as const
	static override props = noteShapeProps
	static override migrations = noteShapeMigrations

	readonly paper = STICKY_PAPER

	override onResize: TLOnResizeHandler<TLNoteShape> = resizeNote
}

/** A note resized: scaled, from the corner dragged, but not so small it can't be read or found. */
export function resizeNote(shape: TLNoteLikeShape, info: Parameters<typeof resizeScaled>[1]) {
	const { x, y, props } = resizeScaled(shape, info)
	return { x, y, props: { scale: Math.max(MIN_NOTE_SCALE, props.scale) } }
}

function getGrowY<S extends TLNoteLikeShape>(
	editor: Editor,
	shape: S,
	{ width, textTop }: NotePaper,
	prevGrowY = 0
) {
	const PADDING = 17

	const html = renderHtmlFromRichText(shape.props.richText, editor.getTextExtensions())
	const nextTextSize = editor.textMeasure.measureHtml(html, {
		...TEXT_PROPS,
		fontFamily: FONT_FAMILIES[shape.props.font],
		fontSize: LABEL_FONT_SIZES[shape.props.size],
		maxWidth: width - PADDING * 2,
	})

	const nextHeight = textTop + nextTextSize.h + PADDING * 2

	let growY: number | null = null

	if (nextHeight > width) {
		growY = nextHeight - width
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

/** The smallest a note scales to: a fifth of its size. */
const MIN_NOTE_SCALE = 0.2

/** A pinned note's pin colour; a sticky has no pin, and reads as the default. */
function pinColorOf(shape: TLNoteLikeShape): PinColor {
	return 'pinColor' in shape.props ? (shape.props.pinColor as PinColor) : 'crimson'
}
