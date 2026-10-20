import { BaseBoxShapeUtil, HTMLContainer, T, gpuColor, type GpuPrimitive, type RecordProps, type TLBaseShape } from '@lifeboard/canvas'

/**
 * A rectangle for the GPU renderer's own checks (docs/gpu-renderer-plan.md, phase 1): the page draws
 * it as a box with a CSS border and radius, the GPU layer draws it from `toGpu`, and `parity.spec.ts`
 * compares the two. Registered only in a browser driven by a test (boardShapeUtils.ts), so no real
 * board ever holds one.
 */
type GpuTestRectShape = TLBaseShape<'gpu-test-rect', { w: number; h: number; fill: string; stroke: string; strokeWidth: number; radius: number }>

export class GpuTestRectShapeUtil extends BaseBoxShapeUtil<GpuTestRectShape> {
	static override type = 'gpu-test-rect' as const
	static override props: RecordProps<GpuTestRectShape> = {
		w: T.nonZeroNumber,
		h: T.nonZeroNumber,
		fill: T.string,
		stroke: T.string,
		strokeWidth: T.number,
		radius: T.number,
	}

	override getDefaultProps(): GpuTestRectShape['props'] {
		return { w: 200, h: 120, fill: '#4f72fc', stroke: '#ffc034', strokeWidth: 6, radius: 18 }
	}

	override component(shape: GpuTestRectShape) {
		const { fill, stroke, strokeWidth, radius } = shape.props
		return (
			<HTMLContainer>
				<div
					style={{
						width: '100%',
						height: '100%',
						boxSizing: 'border-box',
						background: fill,
						border: strokeWidth > 0 ? `${strokeWidth}px solid ${stroke}` : 'none',
						borderRadius: radius,
					}}
				/>
			</HTMLContainer>
		)
	}

	override indicator(shape: GpuTestRectShape) {
		return <rect width={shape.props.w} height={shape.props.h} rx={shape.props.radius} />
	}

	override toGpu(shape: GpuTestRectShape): GpuPrimitive[] {
		const { w, h, fill, stroke, strokeWidth, radius } = shape.props
		return [{ kind: 'rect', x: 0, y: 0, w, h, radius, fill: gpuColor(fill), stroke: strokeWidth > 0 ? gpuColor(stroke) : undefined, strokeWidth }]
	}
}
