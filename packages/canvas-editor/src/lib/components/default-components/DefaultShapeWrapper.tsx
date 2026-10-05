import type { TLShape } from '../../editor/types/shape-types'
import classNames from 'classnames'
import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'

/**
 * What a `ShapeWrapper` gets: the shape, whether this is its background layer, and the element
 * props to pass on to the `div` it renders.
 *
 * @public
 */
export interface TLShapeWrapperProps extends HTMLAttributes<HTMLDivElement> {
	shape: TLShape
	isBackground?: boolean
	children?: ReactNode
}

/** @public */
export type TLShapeWrapperComponent = typeof DefaultShapeWrapper

/**
 * The element each shape is drawn in. Replace it (the `ShapeWrapper` component) to add attributes or
 * classes to every shape; keep forwarding the ref, which the editor positions the shape through.
 *
 * @public
 */
export const DefaultShapeWrapper = forwardRef<HTMLDivElement, TLShapeWrapperProps>(
	function DefaultShapeWrapper({ shape, isBackground = false, className, children, ...props }, ref) {
		return (
			<div
				ref={ref}
				className={classNames('tl-shape', isBackground && 'tl-shape-background', className)}
				data-shape-type={shape.type}
				data-shape-id={shape.id}
				draggable={false}
				{...props}
			>
				{children}
			</div>
		)
	}
)
