import {
	BaseBoxShapeUtil,
	DefaultFontFamilies,
	Editor,
	TLColorMode,
	TLTheme,
	Ellipse2d,
	Geometry2d,
	Group2d,
	HTMLContainer,
	PI2,
	Polygon2d,
	Polyline2d,
	Rectangle2d,
	SVGContainer,
	Stadium2d,
	SvgExportContext,
	renderHtmlFromRichText,
	richTextToPlainText,
	toRichText,
	trimRichText,
	TAU,
	TLDefaultDashStyle,
	TLGeoShape,
	TLOnEditEndHandler,
	TLOnResizeHandler,
	TLShapeUtilCanvasSvgDef,
	Vec2d,
	VecLike,
	exportLabelFromDom,
	geoShapeMigrations,
	geoShapeProps,
	getDefaultColorTheme,
	getPolygonVertices,
} from '@lifeboard/canvas-editor'
import { ShapeFillOverride, ShapeFillOverrideContext } from '../shared/ShapeFill'

import { HyperlinkButton } from '../shared/HyperlinkButton'
import { TextLabel } from '../shared/TextLabel'
import {
	FONT_FAMILIES,
	LABEL_FONT_SIZES,
	STROKE_SIZES,
	TEXT_PROPS,
} from '../shared/default-shape-constants'
import {
	getFillDefForCanvas,
	getFillDefForExport,
	getFontDefForExport,
} from '../shared/defaultStyleDefs'
import { getTextLabelSvgElement } from '../shared/getTextLabelSvgElement'
import { getRoundedInkyPolygonPath, getRoundedPolygonPoints } from '../shared/polygon-helpers'
import { getGeoType } from './customGeoTypes'
import { cloudOutline, cloudSvgPath } from './cloudOutline'
import { DashStyleCloud, DashStyleCloudSvg } from './components/DashStyleCloud'
import { DashStyleEllipse, DashStyleEllipseSvg } from './components/DashStyleEllipse'
import { DashStyleOval, DashStyleOvalSvg } from './components/DashStyleOval'
import { DashStylePolygon, DashStylePolygonSvg } from './components/DashStylePolygon'
import { DrawStyleCloud, DrawStyleCloudSvg } from './components/DrawStyleCloud'
import { DrawStyleEllipseSvg, getEllipseIndicatorPath } from './components/DrawStyleEllipse'
import { DrawStylePolygon, DrawStylePolygonSvg } from './components/DrawStylePolygon'
import { SolidStyleCloud, SolidStyleCloudSvg } from './components/SolidStyleCloud'
import { SolidStyleEllipse, SolidStyleEllipseSvg } from './components/SolidStyleEllipse'
import {
	SolidStyleOval,
	SolidStyleOvalSvg,
	getOvalIndicatorPath,
} from './components/SolidStyleOval'
import { SolidStylePolygon, SolidStylePolygonSvg } from './components/SolidStylePolygon'

const NO_FILL_OVERRIDE: ShapeFillOverride = {}

const LABEL_PADDING = 16
const MIN_SIZE_WITH_LABEL = 17 * 3

/** @public */
/**
 * Options for `GeoShapeUtil.configure`.
 *
 * @public
 */
export interface TLGeoShapeUtilOptions {
	/** Paints to use in place of the ones the shape's colour gives; see `ShapeFillOverride`. */
	getCustomDisplayValues?(
		editor: Editor,
		shape: TLGeoShape,
		theme: TLTheme,
		colorMode: TLColorMode
	): ShapeFillOverride
}

export class GeoShapeUtil extends BaseBoxShapeUtil<TLGeoShape> {
	static override type = 'geo' as const
	static override props = geoShapeProps
	static override migrations = geoShapeMigrations

	override options: TLGeoShapeUtilOptions = {}

	override canEdit = () => true

	override getDefaultProps(): TLGeoShape['props'] {
		return {
			w: 100,
			h: 100,
			geo: 'rectangle',
			color: 'black',
			labelColor: 'black',
			fill: 'none',
			dash: 'draw',
			size: 'm',
			font: 'draw',
			richText: toRichText(''),
			align: 'middle',
			verticalAlign: 'middle',
			growY: 0,
			url: '',
			scale: 1,
			flipX: false,
			flipY: false,
		}
	}

	override getGeometry(shape: TLGeoShape): Geometry2d {
		const w = Math.max(1, shape.props.w)
		const h = Math.max(1, shape.props.h + shape.props.growY)
		const cx = w / 2
		const cy = h / 2

		const strokeWidth = STROKE_SIZES[shape.props.size] * shape.props.scale
		const isFilled = shape.props.fill !== 'none' // || shape.props.text.trim().length > 0

		let body: Geometry2d

		switch (shape.props.geo) {
			case 'cloud': {
				body = new Polygon2d({
					points: cloudOutline(w, h, shape.id, shape.props.size),
					isFilled,
				})
				break
			}
			case 'triangle': {
				body = new Polygon2d({
					points: [new Vec2d(cx, 0), new Vec2d(w, h), new Vec2d(0, h)],
					isFilled,
				})
				break
			}
			case 'diamond': {
				body = new Polygon2d({
					points: [new Vec2d(cx, 0), new Vec2d(w, cy), new Vec2d(cx, h), new Vec2d(0, cy)],
					isFilled,
				})
				break
			}
			case 'pentagon': {
				body = new Polygon2d({
					points: getPolygonVertices(w, h, 5),
					isFilled,
				})
				break
			}
			case 'hexagon': {
				body = new Polygon2d({
					points: getPolygonVertices(w, h, 6),
					isFilled,
				})
				break
			}
			case 'octagon': {
				body = new Polygon2d({
					points: getPolygonVertices(w, h, 8),
					isFilled,
				})
				break
			}
			case 'ellipse': {
				body = new Ellipse2d({
					width: w,
					height: h,
					isFilled,
				})
				break
			}
			case 'oval': {
				body = new Stadium2d({
					width: w,
					height: h,
					isFilled,
				})
				break
			}
			case 'star': {
				// Most of this code is to offset the center, a 5 point star
				// will need to be moved downward because from its center [0,0]
				// it will have a bigger minY than maxY. This is because it'll
				// have 2 points at the bottom.
				const sides = 5
				const step = PI2 / sides / 2
				const rightMostIndex = Math.floor(sides / 4) * 2
				const leftMostIndex = sides * 2 - rightMostIndex
				const topMostIndex = 0
				const bottomMostIndex = Math.floor(sides / 2) * 2
				const maxX = (Math.cos(-TAU + rightMostIndex * step) * w) / 2
				const minX = (Math.cos(-TAU + leftMostIndex * step) * w) / 2

				const minY = (Math.sin(-TAU + topMostIndex * step) * h) / 2
				const maxY = (Math.sin(-TAU + bottomMostIndex * step) * h) / 2
				const diffX = w - Math.abs(maxX - minX)
				const diffY = h - Math.abs(maxY - minY)
				const offsetX = w / 2 + minX - (w / 2 - maxX)
				const offsetY = h / 2 + minY - (h / 2 - maxY)

				const ratio = 1
				const cx = (w - offsetX) / 2
				const cy = (h - offsetY) / 2
				const ox = (w + diffX) / 2
				const oy = (h + diffY) / 2
				const ix = (ox * ratio) / 2
				const iy = (oy * ratio) / 2

				body = new Polygon2d({
					points: Array.from(Array(sides * 2)).map((_, i) => {
						const theta = -TAU + i * step
						return new Vec2d(
							cx + (i % 2 ? ix : ox) * Math.cos(theta),
							cy + (i % 2 ? iy : oy) * Math.sin(theta)
						)
					}),
					isFilled,
				})
				break
			}
			case 'rhombus': {
				const offset = Math.min(w * 0.38, h * 0.38)
				body = new Polygon2d({
					points: [
						new Vec2d(offset, 0),
						new Vec2d(w, 0),
						new Vec2d(w - offset, h),
						new Vec2d(0, h),
					],
					isFilled,
				})
				break
			}
			case 'rhombus-2': {
				const offset = Math.min(w * 0.38, h * 0.38)
				body = new Polygon2d({
					points: [
						new Vec2d(0, 0),
						new Vec2d(w - offset, 0),
						new Vec2d(w, h),
						new Vec2d(offset, h),
					],
					isFilled,
				})
				break
			}
			case 'trapezoid': {
				const offset = Math.min(w * 0.38, h * 0.38)
				body = new Polygon2d({
					points: [
						new Vec2d(offset, 0),
						new Vec2d(w - offset, 0),
						new Vec2d(w, h),
						new Vec2d(0, h),
					],
					isFilled,
				})
				break
			}
			case 'arrow-right': {
				const ox = Math.min(w, h) * 0.38
				const oy = h * 0.16
				body = new Polygon2d({
					points: [
						new Vec2d(0, oy),
						new Vec2d(w - ox, oy),
						new Vec2d(w - ox, 0),
						new Vec2d(w, h / 2),
						new Vec2d(w - ox, h),
						new Vec2d(w - ox, h - oy),
						new Vec2d(0, h - oy),
					],
					isFilled,
				})
				break
			}
			case 'arrow-left': {
				const ox = Math.min(w, h) * 0.38
				const oy = h * 0.16
				body = new Polygon2d({
					points: [
						new Vec2d(ox, 0),
						new Vec2d(ox, oy),
						new Vec2d(w, oy),
						new Vec2d(w, h - oy),
						new Vec2d(ox, h - oy),
						new Vec2d(ox, h),
						new Vec2d(0, h / 2),
					],
					isFilled,
				})
				break
			}
			case 'arrow-up': {
				const ox = w * 0.16
				const oy = Math.min(w, h) * 0.38
				body = new Polygon2d({
					points: [
						new Vec2d(w / 2, 0),
						new Vec2d(w, oy),
						new Vec2d(w - ox, oy),
						new Vec2d(w - ox, h),
						new Vec2d(ox, h),
						new Vec2d(ox, oy),
						new Vec2d(0, oy),
					],
					isFilled,
				})
				break
			}
			case 'arrow-down': {
				const ox = w * 0.16
				const oy = Math.min(w, h) * 0.38
				body = new Polygon2d({
					points: [
						new Vec2d(ox, 0),
						new Vec2d(w - ox, 0),
						new Vec2d(w - ox, h - oy),
						new Vec2d(w, h - oy),
						new Vec2d(w / 2, h),
						new Vec2d(0, h - oy),
						new Vec2d(ox, h - oy),
					],
					isFilled,
				})
				break
			}
			case 'heart': {
				body = new Polygon2d({ points: getHeartPoints(w, h), isFilled })
				break
			}
			case 'check-box':
			case 'x-box':
			case 'rectangle':
			default: {
				// A kind registered with `registerGeoType` (B6): its own outline.
				const custom = getGeoType(shape.props.geo)
				if (custom) {
					body = new Polygon2d({
						points: custom.getVertices(w, h, shape).map((point) => new Vec2d(point.x, point.y)),
						isFilled,
						isSnappable: custom.snapType !== 'blobby',
					})
					break
				}
				body = new Rectangle2d({
					width: w,
					height: h,
					isFilled,
					isSnappable: true,
				})
				break
			}
		}

		// A flipped shape mirrors its outline within its box (tldraw 5.3); the label stays as it reads.
		// Rectangles, ellipses and ovals look the same either way.
		if ((shape.props.flipX || shape.props.flipY) && body instanceof Polygon2d && !(body instanceof Rectangle2d)) {
			body = new Polygon2d({ points: flipPoints(body.vertices, shape.props, w, h), isFilled })
		}

		const labelSize = getLabelSize(this.editor, shape)
		const labelWidth = Math.min(w, Math.max(labelSize.w, Math.min(32, Math.max(1, w - 8))))
		const labelHeight = Math.min(h, Math.max(labelSize.h, Math.min(32, Math.max(1, w - 8))))

		const lines = getLines(shape.props, strokeWidth)
		const edges = lines ? lines.map((line) => new Polyline2d({ points: line })) : []

		return new Group2d({
			children: [
				body,
				new Rectangle2d({
					x:
						shape.props.align === 'start'
							? 0
							: shape.props.align === 'end'
							? w - labelWidth
							: (w - labelWidth) / 2,
					y:
						shape.props.verticalAlign === 'start'
							? 0
							: shape.props.verticalAlign === 'end'
							? h - labelHeight
							: (h - labelHeight) / 2,
					width: labelWidth,
					height: labelHeight,
					isFilled: true,
					isSnappable: false,
					isLabel: true,
				}),
				...edges,
			],
			isSnappable: false,
		})
	}

	override getText(shape: TLGeoShape) {
		return richTextToPlainText(shape.props.richText)
	}

	override onEditEnd: TLOnEditEndHandler<TLGeoShape> = (shape) => {
		const richText = trimRichText(shape.props.richText)
		if (richText !== shape.props.richText) {
			this.editor.updateShapes<TLGeoShape>([{ id: shape.id, type: shape.type, props: { richText } }])
		}
	}

	component(shape: TLGeoShape) {
		const { id, type, props } = shape

		const strokeWidth = STROKE_SIZES[props.size] * props.scale

		const { w, color, labelColor, fill, dash, growY, font, align, verticalAlign, size, richText } =
			props
		const getShape = () => {
			const h = props.h + growY

			switch (props.geo) {
				case 'cloud': {
					if (dash === 'solid') {
						return (
							<SolidStyleCloud
								color={color}
								fill={fill}
								strokeWidth={strokeWidth}
								w={w}
								h={h}
								id={id}
								size={size}
							/>
						)
					} else if (dash === 'dashed' || dash === 'dotted') {
						return (
							<DashStyleCloud
								color={color}
								fill={fill}
								strokeWidth={strokeWidth}
								w={w}
								h={h}
								id={id}
								size={size}
								dash={dash}
							/>
						)
					} else if (dash === 'draw') {
						return (
							<DrawStyleCloud
								color={color}
								fill={fill}
								strokeWidth={strokeWidth}
								w={w}
								h={h}
								id={id}
								size={size}
							/>
						)
					}

					break
				}
				case 'ellipse': {
					if (dash === 'solid') {
						return (
							<SolidStyleEllipse strokeWidth={strokeWidth} w={w} h={h} color={color} fill={fill} />
						)
					} else if (dash === 'dashed' || dash === 'dotted') {
						return (
							<DashStyleEllipse
								id={id}
								strokeWidth={strokeWidth}
								w={w}
								h={h}
								dash={dash}
								color={color}
								fill={fill}
							/>
						)
					} else if (dash === 'draw') {
						return (
							<SolidStyleEllipse strokeWidth={strokeWidth} w={w} h={h} color={color} fill={fill} />
						)
					}
					break
				}
				case 'oval': {
					if (dash === 'solid') {
						return (
							<SolidStyleOval strokeWidth={strokeWidth} w={w} h={h} color={color} fill={fill} />
						)
					} else if (dash === 'dashed' || dash === 'dotted') {
						return (
							<DashStyleOval
								id={id}
								strokeWidth={strokeWidth}
								w={w}
								h={h}
								dash={dash}
								color={color}
								fill={fill}
							/>
						)
					} else if (dash === 'draw') {
						return (
							<SolidStyleOval strokeWidth={strokeWidth} w={w} h={h} color={color} fill={fill} />
						)
					}
					break
				}
				default: {
					const geometry = this.editor.getShapeGeometry(shape)
					const outline =
						geometry instanceof Group2d ? geometry.children[0].vertices : geometry.vertices
					const lines = getLines(shape.props, strokeWidth)
					// A heart's outline is a smooth curve of many points; the hand-drawn style's wobble at
					// each one would make it lumpy, so it is drawn smooth, as tldraw 5 draws it.
					const style = smoothDash(props.geo, dash)

					if (style === 'solid') {
						return (
							<SolidStylePolygon
								fill={fill}
								color={color}
								strokeWidth={strokeWidth}
								outline={outline}
								lines={lines}
							/>
						)
					} else if (style === 'dashed' || style === 'dotted') {
						return (
							<DashStylePolygon
								dash={dash}
								fill={fill}
								color={color}
								strokeWidth={strokeWidth}
								outline={outline}
								lines={lines}
							/>
						)
					} else if (style === 'draw') {
						return (
							<DrawStylePolygon
								id={id}
								fill={fill}
								color={color}
								strokeWidth={strokeWidth}
								outline={outline}
								lines={lines}
							/>
						)
					}
				}
			}
		}

		// A cloud draws from its own path rather than the outline, so a flip mirrors it as a whole.
		const cloudFlip = props.geo === 'cloud' ? getFlipTransform(props, w, props.h + growY) : undefined

		const fillOverride =
			this.options.getCustomDisplayValues?.(
				this.editor,
				shape,
				this.editor.getCurrentTheme(),
				this.editor.getColorMode()
			) ?? NO_FILL_OVERRIDE

		return (
			<>
				<ShapeFillOverrideContext.Provider value={fillOverride}>
					<SVGContainer id={id}>
						{cloudFlip ? <g transform={cloudFlip}>{getShape()}</g> : getShape()}
					</SVGContainer>
				</ShapeFillOverrideContext.Provider>
				<HTMLContainer
					id={shape.id}
					style={{ overflow: 'hidden', width: shape.props.w, height: shape.props.h + props.growY }}
				>
					<TextLabel
						id={id}
						type={type}
						font={font}
						fill={fill}
						size={size}
						align={align}
						verticalAlign={verticalAlign}
						richText={richText}
						labelColor={labelColor}
						wrap
						bounds={props.geo === 'cloud' ? this.getGeometry(shape).bounds : undefined}
						scale={props.scale}
					/>
					{shape.props.url && (
						<HyperlinkButton url={shape.props.url} zoomLevel={this.editor.getZoomLevel()} />
					)}
				</HTMLContainer>
			</>
		)
	}

	indicator(shape: TLGeoShape) {
		const { id, props } = shape
		const { w, size } = props
		const h = props.h + props.growY

		const strokeWidth = STROKE_SIZES[size] * props.scale

		switch (props.geo) {
			case 'ellipse': {
				if (props.dash === 'draw') {
					return <path d={getEllipseIndicatorPath(id, w, h, strokeWidth)} />
				}

				return <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} />
			}
			case 'oval': {
				return <path d={getOvalIndicatorPath(w, h)} />
			}
			case 'cloud': {
				return <path d={cloudSvgPath(w, h, id, size)} transform={getFlipTransform(props, w, h)} />
			}

			default: {
				const geometry = this.editor.getShapeGeometry(shape)
				const outline =
					geometry instanceof Group2d ? geometry.children[0].vertices : geometry.vertices
				let path: string

				if (smoothDash(props.geo, props.dash) === 'draw') {
					const polygonPoints = getRoundedPolygonPoints(id, outline, 0, strokeWidth * 2, 1)
					path = getRoundedInkyPolygonPath(polygonPoints)
				} else {
					path = 'M' + outline[0] + 'L' + outline.slice(1) + 'Z'
				}

				const lines = getLines(shape.props, strokeWidth)

				if (lines) {
					for (const [A, B] of lines) {
						path += `M${A.x},${A.y}L${B.x},${B.y}`
					}
				}

				return <path d={path} />
			}
		}
	}

	/**
	 * The outline for the canvas that draws selected outlines (fork-parity P1): the shape's outline as
	 * its geometry has it, with a box's inner lines.
	 */
	override getIndicatorPath(shape: TLGeoShape) {
		const geometry = this.editor.getShapeGeometry(shape)
		const body = geometry instanceof Group2d ? geometry.children[0]! : geometry
		const path = new Path2D()
		body.vertices.forEach((v, i) => (i ? path.lineTo(v.x, v.y) : path.moveTo(v.x, v.y)))
		path.closePath()
		for (const [a, b] of getLines(shape.props, STROKE_SIZES[shape.props.size] * shape.props.scale) ?? []) {
			path.moveTo(a!.x, a!.y)
			path.lineTo(b!.x, b!.y)
		}
		return path
	}

	override async toSvg(shape: TLGeoShape, ctx: SvgExportContext) {
		const { id, props } = shape
		const strokeWidth = STROKE_SIZES[props.size] * props.scale
		const theme = getDefaultColorTheme({ isDarkMode: this.editor.user.getIsDarkMode() })
		ctx.addExportDef(getFillDefForExport(shape.props.fill, theme))
		const fillOverride = this.options.getCustomDisplayValues?.(
			this.editor,
			shape,
			this.editor.getCurrentTheme(),
			this.editor.getColorMode()
		)

		let svgElm: SVGElement

		switch (props.geo) {
			case 'ellipse': {
				switch (props.dash) {
					case 'draw':
						svgElm = DrawStyleEllipseSvg({
							id,
							w: props.w,
							h: props.h,
							color: props.color,
							fill: props.fill,
							strokeWidth,
							theme,
							fillOverride,
						})
						break

					case 'solid':
						svgElm = SolidStyleEllipseSvg({
							strokeWidth,
							w: props.w,
							h: props.h,
							color: props.color,
							fill: props.fill,
							theme,
							fillOverride,
						})
						break

					default:
						svgElm = DashStyleEllipseSvg({
							id,
							strokeWidth,
							w: props.w,
							h: props.h,
							dash: props.dash,
							color: props.color,
							fill: props.fill,
							theme,
							fillOverride,
						})
						break
				}
				break
			}

			case 'oval': {
				switch (props.dash) {
					case 'draw':
						svgElm = DashStyleOvalSvg({
							id,
							strokeWidth,
							w: props.w,
							h: props.h,
							dash: props.dash,
							color: props.color,
							fill: props.fill,
							theme,
							fillOverride,
						})
						break

					case 'solid':
						svgElm = SolidStyleOvalSvg({
							strokeWidth,
							w: props.w,
							h: props.h,
							color: props.color,
							fill: props.fill,
							theme,
							fillOverride,
						})
						break

					default:
						svgElm = DashStyleOvalSvg({
							id,
							strokeWidth,
							w: props.w,
							h: props.h,
							dash: props.dash,
							color: props.color,
							fill: props.fill,
							theme,
							fillOverride,
						})
				}
				break
			}

			case 'cloud': {
				switch (props.dash) {
					case 'draw':
						svgElm = DrawStyleCloudSvg({
							id,
							strokeWidth,
							w: props.w,
							h: props.h,
							color: props.color,
							fill: props.fill,
							size: props.size,
							theme,
							fillOverride,
						})
						break

					case 'solid':
						svgElm = SolidStyleCloudSvg({
							strokeWidth,
							w: props.w,
							h: props.h,
							color: props.color,
							fill: props.fill,
							size: props.size,
							id,
							theme,
							fillOverride,
						})
						break

					default:
						svgElm = DashStyleCloudSvg({
							id,
							strokeWidth,
							w: props.w,
							h: props.h,
							dash: props.dash,
							color: props.color,
							fill: props.fill,
							theme,
							fillOverride,
							size: props.size,
						})
				}
				// Mirrored inside a group of its own, so the label added below doesn't mirror with it.
				const flip = getFlipTransform(props, props.w, props.h)
				if (flip) {
					const mirrored = document.createElementNS('http://www.w3.org/2000/svg', 'g')
					mirrored.setAttribute('transform', flip)
					mirrored.appendChild(svgElm)
					svgElm = document.createElementNS('http://www.w3.org/2000/svg', 'g')
					svgElm.appendChild(mirrored)
				}
				break
			}
			default: {
				const geometry = this.editor.getShapeGeometry(shape)
				const outline =
					geometry instanceof Group2d ? geometry.children[0].vertices : geometry.vertices
				const lines = getLines(shape.props, strokeWidth)

				switch (smoothDash(props.geo, props.dash)) {
					case 'draw':
						svgElm = DrawStylePolygonSvg({
							id,
							fill: props.fill,
							color: props.color,
							strokeWidth,
							outline,
							lines,
							theme,
							fillOverride,
						})
						break

					case 'solid':
						svgElm = SolidStylePolygonSvg({
							fill: props.fill,
							color: props.color,
							strokeWidth,
							outline,
							lines,
							theme,
							fillOverride,
						})
						break

					default:
						svgElm = DashStylePolygonSvg({
							dash: props.dash,
							fill: props.fill,
							color: props.color,
							strokeWidth,
							outline,
							lines,
							theme,
							fillOverride,
						})
						break
				}
				break
			}
		}

		if (richTextToPlainText(props.richText)) {
			// The label as the canvas shows it, formatting and all; as plain text if it isn't showing.
			const groupEl =
				(await exportLabelFromDom(this.editor, shape, '.tl-text-label', ctx)) ?? this.plainLabelSvg(shape, ctx)

			if (svgElm.nodeName === 'g') {
				svgElm.appendChild(groupEl)
				return svgElm
			} else {
				const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
				g.appendChild(svgElm)
				g.appendChild(groupEl)
				return g
			}
		}

		return svgElm
	}

	private plainLabelSvg(shape: TLGeoShape, ctx: SvgExportContext) {
		const theme = getDefaultColorTheme({ isDarkMode: this.editor.user.getIsDarkMode() })
		const bounds = this.editor.getShapeGeometry(shape).bounds

		ctx.addExportDef(getFontDefForExport(shape.props.font))

		const rootTextElm = getTextLabelSvgElement({
			editor: this.editor,
			shape,
			font: DefaultFontFamilies[shape.props.font],
			bounds,
		})

		const textElm = rootTextElm.cloneNode(true) as SVGTextElement
		textElm.setAttribute('fill', theme[shape.props.labelColor].solid)
		textElm.setAttribute('stroke', 'none')

		const textBgEl = rootTextElm.cloneNode(true) as SVGTextElement
		textBgEl.setAttribute('stroke-width', '2')
		textBgEl.setAttribute('fill', theme.background)
		textBgEl.setAttribute('stroke', theme.background)

		const groupEl = document.createElementNS('http://www.w3.org/2000/svg', 'g')
		groupEl.append(textBgEl)
		groupEl.append(textElm)
		return groupEl
	}

	override getCanvasSvgDefs(): TLShapeUtilCanvasSvgDef[] {
		return [getFillDefForCanvas()]
	}

	override onResize: TLOnResizeHandler<TLGeoShape> = (
		shape,
		{ handle, newPoint, scaleX, scaleY, initialShape }
	) => {
		// use the w/h from props here instead of the initialBounds here,
		// since cloud shapes calculated bounds can differ from the props w/h.
		let w = initialShape.props.w * scaleX
		let h = (initialShape.props.h + initialShape.props.growY) * scaleY
		let overShrinkX = 0
		let overShrinkY = 0

		if (richTextToPlainText(shape.props.richText).trim()) {
			let newW = Math.max(Math.abs(w), MIN_SIZE_WITH_LABEL)
			let newH = Math.max(Math.abs(h), MIN_SIZE_WITH_LABEL)

			if (newW < MIN_SIZE_WITH_LABEL && newH === MIN_SIZE_WITH_LABEL) {
				newW = MIN_SIZE_WITH_LABEL
			}

			if (newW === MIN_SIZE_WITH_LABEL && newH < MIN_SIZE_WITH_LABEL) {
				newH = MIN_SIZE_WITH_LABEL
			}

			const labelSize = getLabelSize(this.editor, {
				...shape,
				props: {
					...shape.props,
					w: newW,
					h: newH,
				},
			})

			const nextW = Math.max(Math.abs(w), labelSize.w) * Math.sign(w)
			const nextH = Math.max(Math.abs(h), labelSize.h) * Math.sign(h)
			overShrinkX = Math.abs(nextW) - Math.abs(w)
			overShrinkY = Math.abs(nextH) - Math.abs(h)

			w = nextW
			h = nextH
		}

		const offset = new Vec2d(0, 0)

		// x offsets

		if (scaleX < 0) {
			offset.x += w
		}

		if (handle === 'left' || handle === 'top_left' || handle === 'bottom_left') {
			offset.x += scaleX < 0 ? overShrinkX : -overShrinkX
		}

		// y offsets

		if (scaleY < 0) {
			offset.y += h
		}

		if (handle === 'top' || handle === 'top_left' || handle === 'top_right') {
			offset.y += scaleY < 0 ? overShrinkY : -overShrinkY
		}

		const { x, y } = offset.rot(shape.rotation).add(newPoint)

		return {
			x,
			y,
			props: {
				w: Math.max(Math.abs(w), 1),
				h: Math.max(Math.abs(h), 1),
				growY: 0,
				// Dragged past the opposite edge, or flipped: the shape mirrors (tldraw 5.3).
				flipX: scaleX < 0 ? !initialShape.props.flipX : initialShape.props.flipX,
				flipY: scaleY < 0 ? !initialShape.props.flipY : initialShape.props.flipY,
			},
		}
	}

	override onBeforeCreate(shape: TLGeoShape) {
		if (!richTextToPlainText(shape.props.richText)) {
			if (shape.props.growY) {
				// No text / some growY, set growY to 0
				return {
					...shape,
					props: {
						...shape.props,
						growY: 0,
					},
				}
			} else {
				// No text / no growY, nothing to change
				return
			}
		}

		const prevHeight = shape.props.h
		const nextHeight = getLabelSize(this.editor, shape).h

		let growY: number | null = null

		if (nextHeight > prevHeight) {
			growY = nextHeight - prevHeight
		} else {
			if (shape.props.growY) {
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

	override onBeforeUpdate = (prev: TLGeoShape, next: TLGeoShape) => {
		const prevText = richTextToPlainText(prev.props.richText)
		const nextText = richTextToPlainText(next.props.richText)

		if (
			prevText === nextText &&
			prev.props.font === next.props.font &&
			prev.props.size === next.props.size
		) {
			return
		}

		if (prevText && !nextText) {
			return {
				...next,
				props: {
					...next.props,
					growY: 0,
				},
			}
		}

		const prevWidth = prev.props.w
		const prevHeight = prev.props.h
		const nextSize = getLabelSize(this.editor, next)
		const nextWidth = nextSize.w
		const nextHeight = nextSize.h

		// When entering the first character in a label (not pasting in multiple characters...)
		if (!prevText && nextText && nextText.length === 1) {
			let w = Math.max(prevWidth, nextWidth)
			let h = Math.max(prevHeight, nextHeight)

			// If both the width and height were less than the minimum size, make the shape square
			if (prev.props.w < MIN_SIZE_WITH_LABEL && prev.props.h < MIN_SIZE_WITH_LABEL) {
				w = Math.max(w, MIN_SIZE_WITH_LABEL)
				h = Math.max(h, MIN_SIZE_WITH_LABEL)
				w = Math.max(w, h)
				h = Math.max(w, h)
			}

			// Don't set a growY—at least, not until we've implemented a growX property
			return {
				...next,
				props: {
					...next.props,
					w,
					h,
					growY: 0,
				},
			}
		}

		let growY: number | null = null

		if (nextHeight > prevHeight) {
			growY = nextHeight - prevHeight
		} else {
			if (prev.props.growY) {
				growY = 0
			}
		}

		if (growY !== null) {
			return {
				...next,
				props: {
					...next.props,
					growY,
					w: Math.max(next.props.w, nextWidth),
				},
			}
		}

		if (nextWidth > prev.props.w) {
			return {
				...next,
				props: {
					...next.props,
					w: nextWidth,
				},
			}
		}
	}

	override onDoubleClick = (shape: TLGeoShape) => {
		// Little easter egg: double-clicking a rectangle / checkbox while
		// holding alt will toggle between check-box and rectangle
		if (this.editor.inputs.altKey) {
			switch (shape.props.geo) {
				case 'rectangle': {
					return {
						...shape,
						props: {
							geo: 'check-box' as const,
						},
					}
				}
				case 'check-box': {
					return {
						...shape,
						props: {
							geo: 'rectangle' as const,
						},
					}
				}
			}
		}

		return
	}
}

function getLabelSize(editor: Editor, shape: TLGeoShape) {
	const text = richTextToPlainText(shape.props.richText)

	if (!text) {
		return { w: 0, h: 0 }
	}

	const minSize = editor.textMeasure.measureText('w', {
		...TEXT_PROPS,
		fontFamily: FONT_FAMILIES[shape.props.font],
		fontSize: LABEL_FONT_SIZES[shape.props.size],
		maxWidth: 100,
	})

	// TODO: Can I get these from somewhere?
	const sizes = {
		s: 2,
		m: 3.5,
		l: 5,
		xl: 10,
	}

	// Measured at the shape's own size, then scaled (fork-parity B10): the text wraps the same at any scale.
	const scale = shape.props.scale
	const html = renderHtmlFromRichText(shape.props.richText, editor.getTextExtensions())
	const size = editor.textMeasure.measureHtml(html, {
		...TEXT_PROPS,
		fontFamily: FONT_FAMILIES[shape.props.font],
		fontSize: LABEL_FONT_SIZES[shape.props.size],
		minWidth: minSize.w + 'px',
		maxWidth: Math.max(
			// Guard because a DOM nodes can't be less 0
			0,
			// A 'w' width that we're setting as the min-width
			Math.ceil(minSize.w + sizes[shape.props.size]),
			// The actual text size
			Math.ceil(shape.props.w / scale - LABEL_PADDING * 2)
		),
	})

	return {
		w: (size.w + LABEL_PADDING * 2) * scale,
		h: (size.h + LABEL_PADDING * 2) * scale,
	}
}

function getLines(props: TLGeoShape['props'], sw: number) {
	const lines = getUnflippedLines(props, sw)
	if (!lines || !(props.flipX || props.flipY)) return lines
	return lines.map((line) => flipPoints(line, props, props.w, props.h))
}

/** Points mirrored within a `w` by `h` box, for a shape flipped either way or both. */
function flipPoints(points: VecLike[], { flipX, flipY }: TLGeoShape['props'], w: number, h: number) {
	return points.map((p) => new Vec2d(flipX ? w - p.x : p.x, flipY ? h - p.y : p.y))
}

/** The SVG transform that mirrors a `w` by `h` box as the shape's flips say, if any. */
function getFlipTransform({ flipX, flipY }: TLGeoShape['props'], w: number, h: number) {
	if (!flipX && !flipY) return undefined
	return `matrix(${flipX ? -1 : 1} 0 0 ${flipY ? -1 : 1} ${flipX ? w : 0} ${flipY ? h : 0})`
}

function getUnflippedLines(props: TLGeoShape['props'], sw: number) {
	switch (props.geo) {
		case 'x-box': {
			return getXBoxLines(props.w, props.h, sw, props.dash)
		}
		case 'check-box': {
			return getCheckBoxLines(props.w, props.h)
		}
		default: {
			return undefined
		}
	}
}

function getXBoxLines(w: number, h: number, sw: number, dash: TLDefaultDashStyle) {
	const inset = dash === 'draw' ? 0.62 : 0

	if (dash === 'dashed') {
		return [
			[new Vec2d(0, 0), new Vec2d(w / 2, h / 2)],
			[new Vec2d(w, h), new Vec2d(w / 2, h / 2)],
			[new Vec2d(0, h), new Vec2d(w / 2, h / 2)],
			[new Vec2d(w, 0), new Vec2d(w / 2, h / 2)],
		]
	}

	const clampX = (x: number) => Math.max(0, Math.min(w, x))
	const clampY = (y: number) => Math.max(0, Math.min(h, y))

	return [
		[
			new Vec2d(clampX(sw * inset), clampY(sw * inset)),
			new Vec2d(clampX(w - sw * inset), clampY(h - sw * inset)),
		],
		[
			new Vec2d(clampX(sw * inset), clampY(h - sw * inset)),
			new Vec2d(clampX(w - sw * inset), clampY(sw * inset)),
		],
	]
}

function getCheckBoxLines(w: number, h: number) {
	const size = Math.min(w, h) * 0.82
	const ox = (w - size) / 2
	const oy = (h - size) / 2

	const clampX = (x: number) => Math.max(0, Math.min(w, x))
	const clampY = (y: number) => Math.max(0, Math.min(h, y))

	return [
		[
			new Vec2d(clampX(ox + size * 0.25), clampY(oy + size * 0.52)),
			new Vec2d(clampX(ox + size * 0.45), clampY(oy + size * 0.82)),
		],
		[
			new Vec2d(clampX(ox + size * 0.45), clampY(oy + size * 0.82)),
			new Vec2d(clampX(ox + size * 0.82), clampY(oy + size * 0.22)),
		],
	]
}

/**
 * The heart's outline (docs/fork-parity.md B6): four cubic curves from the point at the bottom, up
 * each side to the dip at the top, as tldraw 5 draws it (read from its rendered path, every control
 * point a fixed share of the width and height), sampled into points for the outline.
 */
function getHeartPoints(w: number, h: number): Vec2d[] {
	const p = (x: number, y: number) => new Vec2d(x * w, y * h)
	const curves: [Vec2d, Vec2d, Vec2d, Vec2d][] = [
		[p(0.5, 1), p(0.375, 0.75), p(0, 0.625), p(0, 0.3)],
		[p(0, 0.3), p(0, -0.08), p(0.4625, -0.08), p(0.5, 0.225)],
		[p(0.5, 0.225), p(0.5375, -0.08), p(1, -0.08), p(1, 0.3)],
		[p(1, 0.3), p(1, 0.625), p(0.625, 0.75), p(0.5, 1)],
	]
	const points: Vec2d[] = []
	for (const [a, b, c, d] of curves) {
		for (let i = 0; i < HEART_STEPS; i++) {
			const t = i / HEART_STEPS
			const u = 1 - t
			points.push(
				new Vec2d(
					u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
					u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y
				)
			)
		}
	}
	return points
}

/** Points per curve: smooth at any size a board shows. */
const HEART_STEPS = 16

/** The dash a geo shape is drawn with: a heart's hand-drawn style is drawn smooth (see the heart). */
function smoothDash(geo: TLGeoShape['props']['geo'], dash: TLDefaultDashStyle): TLDefaultDashStyle {
	const smooth = geo === 'heart' || getGeoType(geo)?.snapType === 'blobby'
	return smooth && dash === 'draw' ? 'solid' : dash
}
