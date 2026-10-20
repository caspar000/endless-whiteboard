import type { TLUnknownShape } from '@tldraw/tlschema'
import { track, useQuickReactor, useStateTracking } from '@tldraw/state-react'
import {
	TLShapeId,
} from '@tldraw/tlschema'
import * as React from 'react'
import { ShapeUtil } from '../editor/shapes/ShapeUtil'
import { DefaultShapeWrapper } from './default-components/DefaultShapeWrapper'
import { nearestMultiple } from '../hooks/useDPRMultiple'
import { useEditor } from '../hooks/useEditor'
import { useEditorComponents } from '../hooks/useEditorComponents'
import { Matrix2d } from '../primitives/Matrix2d'
import { getGpuScene } from '../gpu/gpuScene'
import { OptionalErrorBoundary } from './ErrorBoundary'

/*
This component renders shapes on the canvas. There are two stages: positioning
and styling the shape's container using CSS, and then rendering the shape's 
JSX using its shape util's render method. Rendering the "inside" of a shape is
more expensive than positioning it or changing its color, so we use React.memo
to wrap the inner shape and only re-render it when the shape's props change. 

The shape also receives props for its index and opacity. The index is used to
determine the z-index of the shape, and the opacity is used to set the shape's
opacity based on its own opacity and that of its parent's.
*/
export const Shape = track(function Shape({
	id,
	util,
	index,
	backgroundIndex,
	opacity,
}: {
	id: TLShapeId
	util: ShapeUtil
	index: number
	backgroundIndex: number
	opacity: number
}) {
	const editor = useEditor()
	// Read here rather than passed down: the list of shapes to render does not change when a shape
	// moves, so it cannot carry the record. Read inside `track`, a change re-renders this shape only.
	const shape = editor.getShape(id)

	const { ShapeErrorFallback, ShapeWrapper: ShapeWrapperOrNull } = useEditorComponents()
	const ShapeWrapper = ShapeWrapperOrNull ?? DefaultShapeWrapper

	const containerRef = React.useRef<HTMLDivElement>(null)
	const backgroundContainerRef = React.useRef<HTMLDivElement>(null)

	const setProperty = React.useCallback((property: string, value: string) => {
		containerRef.current?.style.setProperty(property, value)
		backgroundContainerRef.current?.style.setProperty(property, value)
	}, [])

	useQuickReactor(
		'set shape container transform position',
		() => {
			const shape = editor.getShape(id)
			if (!shape) return // probably the shape was just deleted

			const pageTransform = editor.getShapePageTransform(id)
			const transform = Matrix2d.toCssString(pageTransform)
			setProperty('transform', transform)
		},
		[editor, setProperty]
	)

	useQuickReactor(
		'set shape container clip path',
		() => {
			const shape = editor.getShape(id)
			if (!shape) return null

			const clipPath = editor.getShapeClipPath(id)
			setProperty('clip-path', clipPath ?? 'none')
		},
		[editor, setProperty]
	)

	useQuickReactor(
		'set shape height and width',
		() => {
			const shape = editor.getShape(id)
			if (!shape) return null

			const bounds = editor.getShapeGeometry(shape).bounds
			const dpr = Math.floor(editor.getDevicePixelRatio() * 100) / 100
			// dprMultiple is the smallest number we can multiply dpr by to get an integer
			// it's usually 1, 2, or 4 (for e.g. dpr of 2, 2.5 and 2.25 respectively)
			const dprMultiple = nearestMultiple(dpr)
			// We round the shape width and height up to the nearest multiple of dprMultiple to avoid the browser
			// making miscalculations when applying the transform.
			const widthRemainder = bounds.w % dprMultiple
			const width = widthRemainder === 0 ? bounds.w : bounds.w + (dprMultiple - widthRemainder)
			const heightRemainder = bounds.h % dprMultiple
			const height = heightRemainder === 0 ? bounds.h : bounds.h + (dprMultiple - heightRemainder)
			setProperty('width', Math.max(width, dprMultiple) + 'px')
			setProperty('height', Math.max(height, dprMultiple) + 'px')
		},
		[editor]
	)

	// A culled shape stays mounted and is only hidden, as in today's tldraw: what it draws (a table's
	// value, a view's cards) is still in the page, and scrolling it back in costs no remount. Written
	// straight to the container, so the camera moving re-renders nothing in React.
	const rDisplay = React.useRef<string | null>(null)
	useQuickReactor(
		'set shape container display',
		() => {
			const display = editor._isShapeCulledForRender(id) ? 'none' : 'block'
			if (rDisplay.current === display) return
			rDisplay.current = display
			setProperty('display', display)
		},
		[editor, setProperty]
	)

	// Drawn by the GPU layer (docs/gpu-renderer-plan.md): the element stays, laid out and in the
	// page for editing, events, exports and tests, but isn't painted.
	const rVisibility = React.useRef<string | null>(null)
	useQuickReactor(
		'set shape container visibility',
		() => {
			const visibility = getGpuScene(editor).hidesElement(id) ? 'hidden' : ''
			if (rVisibility.current === visibility) return
			rVisibility.current = visibility
			setProperty('visibility', visibility)
		},
		[editor, setProperty]
	)

	// Set the opacity of the container when the opacity changes
	React.useLayoutEffect(() => {
		setProperty('opacity', opacity + '')
		containerRef.current?.style.setProperty('z-index', index + '')
		backgroundContainerRef.current?.style.setProperty('z-index', backgroundIndex + '')
	}, [opacity, index, backgroundIndex, setProperty])

	const annotateError = React.useCallback(
		(error: any) => {
			editor.annotateError(error, { origin: 'react.shape', willCrashApp: false })
		},
		[editor]
	)

	if (!shape) return null

	return (
		<>
			{util.backgroundComponent && (
				<ShapeWrapper ref={backgroundContainerRef} shape={shape} isBackground>
					<OptionalErrorBoundary fallback={ShapeErrorFallback} onError={annotateError}>
						<InnerShapeBackground shape={shape} util={util} />
					</OptionalErrorBoundary>
				</ShapeWrapper>
			)}
			<ShapeWrapper ref={containerRef} shape={shape}>
				<OptionalErrorBoundary fallback={ShapeErrorFallback as any} onError={annotateError}>
					<InnerShape shape={shape} util={util} />
				</OptionalErrorBoundary>
			</ShapeWrapper>
		</>
	)
})

const InnerShape = React.memo(
	function InnerShape<T extends TLUnknownShape>({ shape, util }: { shape: T; util: ShapeUtil<T> }) {
		return useStateTracking('InnerShape:' + shape.type, () => util.component(shape))
	},
	(prev, next) =>
		prev.shape.props === next.shape.props &&
		prev.shape.meta === next.shape.meta &&
		prev.util === next.util
)

const InnerShapeBackground = React.memo(
	function InnerShapeBackground<T extends TLUnknownShape>({
		shape,
		util,
	}: {
		shape: T
		util: ShapeUtil<T>
	}) {
		return useStateTracking('InnerShape:' + shape.type, () => util.backgroundComponent?.(shape))
	},
	(prev, next) => prev.shape.props === next.shape.props && prev.shape.meta === next.shape.meta
)
