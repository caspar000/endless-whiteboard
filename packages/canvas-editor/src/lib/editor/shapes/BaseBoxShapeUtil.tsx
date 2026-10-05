import { TLBaseShape } from '@tldraw/tlschema'
import { Geometry2d } from '../../primitives/geometry/Geometry2d'
import { Rectangle2d } from '../../primitives/geometry/Rectangle2d'
import type { TLShapePartial } from '../types/shape-types'
import { ShapeUtil, TLOnResizeHandler, TLResizeInfo } from './ShapeUtil'
import { resizeBox } from './shared/resizeBox'

/** @public */
export type TLBaseBoxShape = TLBaseShape<string, { w: number; h: number }>

/** @public */
export abstract class BaseBoxShapeUtil<Shape extends TLBaseBoxShape> extends ShapeUtil<Shape> {
	getGeometry(shape: Shape): Geometry2d {
		return new Rectangle2d({
			width: shape.props.w,
			height: shape.props.h,
			isFilled: true,
		})
	}

	override onResize(shape: Shape, info: TLResizeInfo<Shape>): ReturnType<TLOnResizeHandler<Shape>> {
		// Every box shape has `w` and `h`; TypeScript can't see that through the generic.
		return resizeBox(shape, info) as unknown as Omit<TLShapePartial<Shape>, 'id' | 'type'>
	}
}
