import type { MigrationSequence } from '@tldraw/store'
import type { TLHandle, TLShape, TLShapePartial } from '../types/shape-types'
/* eslint-disable @typescript-eslint/no-unused-vars */
import {
	RecordProps,
	TLPropsMigrations,
	TLUnknownShape,
} from '@tldraw/tlschema'
import { Box2d } from '../../primitives/Box2d'
import { Vec2d } from '../../primitives/Vec2d'
import { Geometry2d } from '../../primitives/geometry/Geometry2d'
import type { Editor } from '../Editor'
import { SvgExportContext } from '../types/SvgExportContext'
import { TLResizeHandle } from '../types/selection-types'

/** @public */
export interface TLShapeUtilConstructor<
	T extends TLUnknownShape,
	U extends ShapeUtil<T> = ShapeUtil<T>
> {
	new (editor: Editor): U
	type: T['type']
	props?: RecordProps<T>
	migrations?: TLPropsMigrations | MigrationSequence
}

/**
 * What `ShapeUtil.canBind` is asked about.
 *
 * @public
 */
export interface TLShapeUtilCanBindOpts {
	/** The type of shape the binding starts from, e.g. `arrow`. */
	fromShapeType: string
	/** The type of shape being bound to: the util's own. */
	toShapeType: string
	/** The type of binding, e.g. `arrow`. */
	bindingType: string
}

/** @public */
export type TLShapeUtilFlag<T> = (shape: T) => boolean

/** @public */
export interface TLShapeUtilCanvasSvgDef {
	key: string
	component: React.ComponentType
}

/** @public */
export abstract class ShapeUtil<Shape extends TLUnknownShape = TLUnknownShape> {
	constructor(public editor: Editor) {}

	/** Options the util was set up with; see `configure`. Each util declares its own. @public */
	options: object = {}

	/**
	 * This util with some of its options changed, as a new util class to pass to the editor in its
	 * place (same type, same shapes).
	 *
	 * @public
	 */
	static configure<T extends abstract new (editor: Editor) => ShapeUtil<TLUnknownShape>>(
		this: T,
		options: Partial<InstanceType<T>['options']>
	): T {
		const Base = this as unknown as new (editor: Editor) => ShapeUtil<TLUnknownShape>
		// Abstract only to TypeScript: the class it extends is a concrete util.
		abstract class Configured extends Base {
			constructor(editor: Editor) {
				super(editor)
				this.options = { ...this.options, ...options }
			}
		}
		const props = (this as unknown as typeof ShapeUtil).propsForOptions?.(options)
		if (props) (Configured as unknown as typeof ShapeUtil).props = props
		return Configured as unknown as T
	}
	/**
	 * Props that depend on `configure`'s options, such as a frame whose `color` becomes a style when it
	 * shows colours. Without it, a configured util keeps the props of the util it configures.
	 */
	static propsForOptions?(options: object): RecordProps<TLUnknownShape> | undefined
	static props?: RecordProps<TLUnknownShape>
	// Props-only migrations, or a full record sequence (today's arrow shape ships one).
	static migrations?: TLPropsMigrations | MigrationSequence

	/**
	 * The type of the shape util, which should match the shape's type.
	 *
	 * @public
	 */
	static type: string

	/**
	 * Get the default props for a shape.
	 *
	 * @public
	 */
	abstract getDefaultProps(): Shape['props']

	/**
	 * Get the shape's geometry.
	 *
	 * @param shape - The shape.
	 * @public
	 */
	abstract getGeometry(shape: Shape): Geometry2d

	/**
	 * Get a JSX element for the shape (as an HTML element).
	 *
	 * @param shape - The shape.
	 * @public
	 */
	abstract component(shape: Shape): any

	/**
	 * Get JSX describing the shape's indicator (as an SVG element). By default, the outline of the
	 * shape's geometry.
	 *
	 * @param shape - The shape.
	 * @public
	 */
	indicator(shape: Shape): any {
		const { vertices, isClosed } = this.editor.getShapeGeometry(shape as unknown as TLShape)
		if (!vertices.length) return null
		const d = vertices.map((v, i) => `${i ? 'L' : 'M'}${v.x},${v.y}`).join(' ') + (isClosed ? ' Z' : '')
		return <path d={d} />
	}

	/**
	 * Today's way to describe an indicator, as a canvas path. The fork draws indicators as SVG and can't
	 * read a `Path2D` back, so a util that has this gets the default indicator above, the outline of
	 * its geometry. For Lifeboard's nodes the two are the same rectangle.
	 *
	 * @public
	 */
	getIndicatorPath?(shape: Shape): Path2D | undefined

	/**
	 * The shape's text, for search and for reading the board without seeing it. Shapes that hold text
	 * return it; others return nothing.
	 *
	 * @public
	 */
	getText(_shape: Shape): string | undefined {
		return undefined
	}

	/**
	 * Whether the shape can be snapped to by another shape.
	 *
	 * @public
	 */
	canSnap(_shape: Shape): boolean {
		return true
	}

	/**
	 * Whether the shape can be scrolled while editing.
	 *
	 * @public
	 */
	canScroll(_shape: Shape): boolean {
		return false
	}

	/**
	 * Whether the shape should unmount when not visible in the editor. Consider keeping this to false if the shape's `component` has local state.
	 *
	 * @public
	 */
	canUnmount(_shape: Shape): boolean {
		return true
	}

	/**
	 * Whether a binding may attach to a shape of this type. Asked of the util of the shape being
	 * bound to (`toShapeType`). Today's form of the question; the 2023 one passed the shape.
	 *
	 * @public
	 */
	canBind(_opts: TLShapeUtilCanBindOpts): boolean {
		return true
	}

	/**
	 * Whether the shape can be double clicked to edit.
	 *
	 * @public
	 */
	canEdit(_shape: Shape): boolean {
		return false
	}

	/**
	 * Whether the shape can be resized.
	 *
	 * @public
	 */
	canResize(_shape: Shape): boolean {
		return true
	}

	/**
	 * Whether the shape can be edited in read-only mode.
	 *
	 * @public
	 */
	canEditInReadOnly(_shape: Shape): boolean {
		return false
	}

	/**
	 * Whether the shape can be cropped.
	 *
	 * @public
	 */
	canCrop(_shape: Shape): boolean {
		return false
	}

	/**
	 * Does this shape provide a background for its children? If this is true,
	 * then any children with a `renderBackground` method will have their
	 * backgrounds rendered _above_ this shape. Otherwise, the children's
	 * backgrounds will be rendered above either the next ancestor that provides
	 * a background, or the canvas background.
	 *
	 * @internal
	 */
	providesBackgroundForChildren(shape: Shape): boolean {
		return false
	}

	/**
	 * Whether the shape should hide its resize handles when selected.
	 *
	 * @public
	 */
	hideResizeHandles(_shape: Shape): boolean {
		return false
	}

	/**
	 * Whether the shape should hide its resize handles when selected.
	 *
	 * @public
	 */
	hideRotateHandle(_shape: Shape): boolean {
		return false
	}

	/**
	 * Whether the shape should hide its selection bounds background when selected.
	 *
	 * @public
	 */
	hideSelectionBoundsBg(_shape: Shape): boolean {
		return false
	}

	/**
	 * Whether the shape should hide its selection bounds foreground when selected.
	 *
	 * @public
	 */
	hideSelectionBoundsFg(_shape: Shape): boolean {
		return false
	}

	/**
	 * Whether the shape's aspect ratio is locked.
	 *
	 * @public
	 */
	isAspectRatioLocked(_shape: Shape): boolean {
		return false
	}

	/**
	 * Get a JSX element for the shape (as an HTML element) to be rendered as part of the canvas background - behind any other shape content.
	 *
	 * @param shape - The shape.
	 * @internal
	 */
	backgroundComponent?(shape: Shape): any

	/**
	 * Get an array of handle models for the shape. This is an optional method.
	 *
	 * @example
	 *
	 * ```ts
	 * util.getHandles?.(myShape)
	 * ```
	 *
	 * @param shape - The shape.
	 * @public
	 */
	getHandles?(shape: Shape): TLHandle[]

	/**
	 * Get an array of outline segments for the shape. For most shapes,
	 * this will be a single segment that includes the entire outline.
	 * For shapes with handles, this might be segments of the outline
	 * between each handle.
	 *
	 * @example
	 *
	 * ```ts
	 * util.getOutlineSegments(myShape)
	 * ```
	 *
	 * @param shape - The shape.
	 * @public
	 */
	getOutlineSegments(shape: Shape): Vec2d[][] {
		return [this.editor.getShapeGeometry(shape as unknown as TLShape).vertices]
	}

	/**
	 * Get whether the shape can receive children of a given type.
	 *
	 * @param type - The shape type.
	 * @public
	 */
	canReceiveNewChildrenOfType(shape: Shape, type: TLShape['type']) {
		return false
	}

	/**
	 * Get whether the shape can receive children of a given type.
	 *
	 * @param shape - The shape type.
	 * @param shapes - The shapes that are being dropped.
	 * @public
	 */
	canDropShapes(shape: Shape, shapes: TLShape[]) {
		return true
	}

	/**
	 * Get the shape as an SVG object.
	 *
	 * @param shape - The shape.
	 * @param ctx - The export context for the SVG - used for adding e.g. \<def\>s
	 * @returns An SVG element.
	 * @public
	 */
	toSvg?(shape: Shape, ctx: SvgExportContext): SVGElement | Promise<SVGElement>

	/**
	 * Get the shape's background layer as an SVG object.
	 *
	 * @param shape - The shape.
	 * @param ctx - ctx - The export context for the SVG - used for adding e.g. \<def\>s
	 * @returns An SVG element.
	 * @public
	 */
	toBackgroundSvg?(shape: Shape, ctx: SvgExportContext): SVGElement | Promise<SVGElement> | null

	/** @internal */
	expandSelectionOutlinePx(shape: Shape): number {
		return 0
	}

	/**
	 * Return elements to be added to the \<defs\> section of the canvases SVG context. This can be
	 * used to define SVG content (e.g. patterns & masks) that can be referred to by ID from svg
	 * elements returned by `component`.
	 *
	 * Each def should have a unique `key`. If multiple defs from different shapes all have the same
	 * key, only one will be used.
	 */
	getCanvasSvgDefs(): TLShapeUtilCanvasSvgDef[] {
		return []
	}

	//  Events

	/**
	 * A callback called just before a shape is created. This method provides a last chance to modify
	 * the created shape.
	 *
	 * @example
	 *
	 * ```ts
	 * onBeforeCreate = (next) => {
	 * 	return { ...next, x: next.x + 1 }
	 * }
	 * ```
	 *
	 * @param next - The next shape.
	 * @returns The next shape or void.
	 * @public
	 */
	onBeforeCreate?(...args: Parameters<TLOnBeforeCreateHandler<Shape>>): ReturnType<TLOnBeforeCreateHandler<Shape>>

	/**
	 * A callback called just before a shape is updated. This method provides a last chance to modify
	 * the updated shape.
	 *
	 * @example
	 *
	 * ```ts
	 * onBeforeUpdate = (prev, next) => {
	 * 	if (prev.x === next.x) {
	 * 		return { ...next, x: next.x + 1 }
	 * 	}
	 * }
	 * ```
	 *
	 * @param prev - The previous shape.
	 * @param next - The next shape.
	 * @returns The next shape or void.
	 * @public
	 */
	onBeforeUpdate?(...args: Parameters<TLOnBeforeUpdateHandler<Shape>>): ReturnType<TLOnBeforeUpdateHandler<Shape>>

	/**
	 * Other shapes were dragged onto this one: called once, as they arrive. A shape whose util has any
	 * of the four drag-and-drop hooks is a drop target, and the topmost target under the pointer wins.
	 *
	 * @returns Whether to hint that this shape will take them.
	 * @public
	 */
	onDragShapesIn?(shape: Shape, shapes: TLShape[]): { shouldHint: boolean } | void

	/**
	 * Shapes already over this one moved: called on later frames, when the pointer moves.
	 *
	 * @returns Whether to hint that this shape will take them.
	 * @public
	 */
	onDragShapesOver?(shape: Shape, shapes: TLShape[]): { shouldHint: boolean } | void

	/**
	 * A callback called when some other shapes are dragged out of this one.
	 *
	 * @param shape - The shape.
	 * @param shapes - The shapes that are being dragged out.
	 * @public
	 */
	onDragShapesOut?(...args: Parameters<TLOnDragHandler<Shape>>): ReturnType<TLOnDragHandler<Shape>>

	/**
	 * A callback called when some other shapes are dropped over this one. Only the shapes
	 * `canReceiveNewChildrenOfType` accepts arrive, and it isn't called if there are none.
	 *
	 * @param shape - The shape.
	 * @param shapes - The shapes that are being dropped over this one.
	 * @public
	 */
	onDropShapesOver?(...args: Parameters<TLOnDragHandler<Shape>>): ReturnType<TLOnDragHandler<Shape>>

	/**
	 * A callback called when a shape starts being resized.
	 *
	 * @param shape - The shape.
	 * @returns A change to apply to the shape, or void.
	 * @public
	 */
	onResizeStart?(...args: Parameters<TLOnResizeStartHandler<Shape>>): ReturnType<TLOnResizeStartHandler<Shape>>

	/**
	 * A callback called when a shape changes from a resize.
	 *
	 * @param shape - The shape at the start of the resize.
	 * @param info - Info about the resize.
	 * @returns A change to apply to the shape, or void.
	 * @public
	 */
	onResize?(...args: Parameters<TLOnResizeHandler<Shape>>): ReturnType<TLOnResizeHandler<Shape>>

	/**
	 * A callback called when a shape finishes resizing.
	 *
	 * @param initial - The shape at the start of the resize.
	 * @param current - The current shape.
	 * @returns A change to apply to the shape, or void.
	 * @public
	 */
	onResizeEnd?(...args: Parameters<TLOnResizeEndHandler<Shape>>): ReturnType<TLOnResizeEndHandler<Shape>>

	/**
	 * A callback called when a shape starts being translated.
	 *
	 * @param shape - The shape.
	 * @returns A change to apply to the shape, or void.
	 * @public
	 */
	onTranslateStart?(...args: Parameters<TLOnTranslateStartHandler<Shape>>): ReturnType<TLOnTranslateStartHandler<Shape>>

	/**
	 * A callback called when a shape changes from a translation.
	 *
	 * @param initial - The shape at the start of the translation.
	 * @param current - The current shape.
	 * @returns A change to apply to the shape, or void.
	 * @public
	 */
	onTranslate?(...args: Parameters<TLOnTranslateHandler<Shape>>): ReturnType<TLOnTranslateHandler<Shape>>

	/**
	 * A callback called when a shape finishes translating.
	 *
	 * @param initial - The shape at the start of the translation.
	 * @param current - The current shape.
	 * @returns A change to apply to the shape, or void.
	 * @public
	 */
	onTranslateEnd?(...args: Parameters<TLOnTranslateEndHandler<Shape>>): ReturnType<TLOnTranslateEndHandler<Shape>>

	/**
	 * A callback called when a shape starts being rotated.
	 *
	 * @param shape - The shape.
	 * @returns A change to apply to the shape, or void.
	 * @public
	 */
	onRotateStart?(...args: Parameters<TLOnRotateStartHandler<Shape>>): ReturnType<TLOnRotateStartHandler<Shape>>

	/**
	 * A callback called when a shape changes from a rotation.
	 *
	 * @param initial - The shape at the start of the rotation.
	 * @param current - The current shape.
	 * @returns A change to apply to the shape, or void.
	 * @public
	 */
	onRotate?(...args: Parameters<TLOnRotateHandler<Shape>>): ReturnType<TLOnRotateHandler<Shape>>

	/**
	 * A callback called when a shape finishes rotating.
	 *
	 * @param initial - The shape at the start of the rotation.
	 * @param current - The current shape.
	 * @returns A change to apply to the shape, or void.
	 * @public
	 */
	onRotateEnd?(...args: Parameters<TLOnRotateEndHandler<Shape>>): ReturnType<TLOnRotateEndHandler<Shape>>

	/**
	 * A callback called when a shape's handle changes.
	 *
	 * @param shape - The current shape.
	 * @param info - An object containing the handle and whether the handle is 'precise' or not.
	 * @returns A change to apply to the shape, or void.
	 * @public
	 */
	onHandleChange?(...args: Parameters<TLOnHandleChangeHandler<Shape>>): ReturnType<TLOnHandleChangeHandler<Shape>>

	/**
	 * A handle is being dragged: today's name for `onHandleChange`, with whether the drag is creating
	 * the shape. Override either; the editor calls this one, which hands over to `onHandleChange`.
	 *
	 * @public
	 */
	onHandleDrag(shape: Shape, info: TLHandleDragInfo<Shape>): TLShapePartial<Shape> | void {
		return this.onHandleChange?.(shape, info)
	}

	/**
	 * Not currently used.
	 *
	 * @internal
	 */
	onBindingChange?(...args: Parameters<TLOnBindingChangeHandler<Shape>>): ReturnType<TLOnBindingChangeHandler<Shape>>

	/**
	 * A callback called when a shape's children change.
	 *
	 * @param shape - The shape.
	 * @returns An array of shape updates, or void.
	 * @public
	 */
	onChildrenChange?(...args: Parameters<TLOnChildrenChangeHandler<Shape>>): ReturnType<TLOnChildrenChangeHandler<Shape>>

	/**
	 * A callback called when a shape's handle is double clicked.
	 *
	 * @param shape - The shape.
	 * @param handle - The handle that is double-clicked.
	 * @returns A change to apply to the shape, or void.
	 * @public
	 */
	onDoubleClickHandle?(...args: Parameters<TLOnDoubleClickHandleHandler<Shape>>): ReturnType<TLOnDoubleClickHandleHandler<Shape>>

	/**
	 * A callback called when a shape's edge is double clicked.
	 *
	 * @param shape - The shape.
	 * @returns A change to apply to the shape, or void.
	 * @public
	 */
	onDoubleClickEdge?(...args: Parameters<TLOnDoubleClickHandler<Shape>>): ReturnType<TLOnDoubleClickHandler<Shape>>

	/**
	 * A callback called when a shape is double clicked.
	 *
	 * @param shape - The shape.
	 * @returns A change to apply to the shape, or void.
	 * @public
	 */
	onDoubleClick?(...args: Parameters<TLOnDoubleClickHandler<Shape>>): ReturnType<TLOnDoubleClickHandler<Shape>>

	/**
	 * A callback called when a shape is clicked.
	 *
	 * @param shape - The shape.
	 * @returns A change to apply to the shape, or void.
	 * @public
	 */
	onClick?(...args: Parameters<TLOnClickHandler<Shape>>): ReturnType<TLOnClickHandler<Shape>>

	/**
	 * A callback called when a shape finishes being editing.
	 *
	 * @param shape - The shape.
	 * @public
	 */
	onEditEnd?(...args: Parameters<TLOnEditEndHandler<Shape>>): ReturnType<TLOnEditEndHandler<Shape>>
}

/** @public */
export type TLOnBeforeCreateHandler<T extends TLUnknownShape> = (next: T) => T | void
/** @public */
export type TLOnBeforeUpdateHandler<T extends TLUnknownShape> = (prev: T, next: T) => T | void
/** @public */
export type TLOnTranslateStartHandler<T extends TLUnknownShape> = TLEventStartHandler<T>
/** @public */
export type TLOnTranslateHandler<T extends TLUnknownShape> = TLEventChangeHandler<T>
/** @public */
export type TLOnTranslateEndHandler<T extends TLUnknownShape> = TLEventChangeHandler<T>
/** @public */
export type TLOnRotateStartHandler<T extends TLUnknownShape> = TLEventStartHandler<T>
/** @public */
export type TLOnRotateHandler<T extends TLUnknownShape> = TLEventChangeHandler<T>
/** @public */
export type TLOnRotateEndHandler<T extends TLUnknownShape> = TLEventChangeHandler<T>

/**
 * The type of resize.
 *
 * 'scale_shape' - The shape is being scaled, usually as part of a larger selection.
 *
 * 'resize_bounds' - The user is directly manipulating an individual shape's bounds using a resize
 * handle. It is up to shape util implementers to decide how they want to handle the two
 * situations.
 *
 * @public
 */
export type TLResizeMode = 'scale_shape' | 'resize_bounds'

/**
 * Info about a resize.
 * @param newPoint - The new local position of the shape.
 * @param handle - The handle being dragged.
 * @param mode - The type of resize.
 * @param scaleX - The scale in the x-axis.
 * @param scaleY - The scale in the y-axis.
 * @param initialBounds - The bounds of the shape at the start of the resize.
 * @param initialShape - The shape at the start of the resize.
 * @public
 */
export type TLResizeInfo<T extends TLUnknownShape> = {
	newPoint: Vec2d
	handle: TLResizeHandle
	mode: TLResizeMode
	scaleX: number
	scaleY: number
	initialBounds: Box2d
	initialShape: T
}

/** @public */
export type TLOnResizeHandler<T extends TLUnknownShape> = (
	shape: T,
	info: TLResizeInfo<T>
) => Omit<TLShapePartial<T>, 'id' | 'type'> | undefined | void

/** @public */
export type TLOnResizeStartHandler<T extends TLUnknownShape> = TLEventStartHandler<T>

/** @public */
export type TLOnResizeEndHandler<T extends TLUnknownShape> = TLEventChangeHandler<T>

/* -------------------- Dragging -------------------- */

/** @public */
export type TLOnDragHandler<T extends TLUnknownShape, R = void> = (shape: T, shapes: TLShape[]) => R

/** @internal */
export type TLOnBindingChangeHandler<T extends TLUnknownShape> = (shape: T) => TLShapePartial<T> | void

/** @public */
export type TLOnChildrenChangeHandler<T extends TLUnknownShape> = (shape: T) => TLShapePartial[] | void

/** @public */
export type TLOnHandleChangeHandler<T extends TLUnknownShape> = (
	shape: T,
	info: {
		handle: TLHandle
		isPrecise: boolean
		initial?: T | undefined
	}
) => TLShapePartial<T> | void

/**
 * What `onHandleDrag` hears about a handle being dragged.
 *
 * @public
 */
export interface TLHandleDragInfo<T extends TLUnknownShape> {
	handle: TLHandle
	isPrecise: boolean
	/** Whether this drag is creating the shape (drawing a new arrow, say) rather than editing it. */
	isCreatingShape: boolean
	initial?: T | undefined
}

/** @public */
export type TLOnClickHandler<T extends TLUnknownShape> = (shape: T) => TLShapePartial<T> | void
/** @public */
export type TLOnEditEndHandler<T extends TLUnknownShape> = (shape: T) => void
/** @public */
export type TLOnDoubleClickHandler<T extends TLUnknownShape> = (shape: T) => TLShapePartial<T> | void
/** @public */
export type TLOnDoubleClickHandleHandler<T extends TLUnknownShape> = (
	shape: T,
	handle: TLHandle
) => TLShapePartial<T> | void

type TLEventStartHandler<T extends TLUnknownShape> = (shape: T) => TLShapePartial<T> | void
type TLEventChangeHandler<T extends TLUnknownShape> = (initial: T, current: T) => TLShapePartial<T> | void
