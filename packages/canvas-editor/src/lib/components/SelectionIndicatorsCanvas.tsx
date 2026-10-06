import { useQuickReactor } from '@tldraw/state-react'
import type { TLShapeId } from '@tldraw/tlschema'
import * as React from 'react'
import type { Editor } from '../editor/Editor'
import { ShapeUtil } from '../editor/shapes/ShapeUtil'
import type { TLShape } from '../editor/types/shape-types'
import { useEditor } from '../hooks/useEditor'
import type { Geometry2d } from '../primitives/geometry/Geometry2d'

/**
 * The selected shapes' outlines, drawn on one 2D canvas rather than as an SVG each (docs/fork-parity.md
 * P1). Brushing across a big board selects hundreds of shapes a frame at a time, and painting an SVG
 * per outline was what dropped frames; strokes on a canvas cost next to nothing.
 *
 * A shape's outline comes from its util's `getIndicatorPath`, or from its geometry when the util draws
 * the default outline; Lifeboard's nodes are all one or the other. A shape whose util draws its own
 * outline (an arrow, a pen stroke) keeps its SVG indicator (Canvas.tsx's `SelectedIdIndicators`).
 */
export function SelectionIndicatorsCanvas({ ids }: { ids: TLShapeId[] }) {
	const editor = useEditor()
	const rCanvas = React.useRef<HTMLCanvasElement>(null)

	useQuickReactor(
		'draw selected outlines',
		() => {
			const canvas = rCanvas.current
			if (!canvas) return
			const { w, h } = editor.getViewportScreenBounds()
			const { x: cx, y: cy, z } = editor.getCamera()
			const dpr = window.devicePixelRatio || 1
			const width = Math.round(w * dpr)
			const height = Math.round(h * dpr)
			if (canvas.width !== width || canvas.height !== height) {
				canvas.width = width
				canvas.height = height
			}
			const ctx = canvas.getContext('2d')
			if (!ctx) return
			ctx.setTransform(1, 0, 0, 1, 0, 0)
			ctx.clearRect(0, 0, width, height)
			// Read so a theme switch redraws in the other mode's colour.
			editor.user.getIsDarkMode()
			ctx.strokeStyle = getComputedStyle(canvas).getPropertyValue('--color-selected').trim() || '#2f80ed'
			ctx.lineWidth = 1.5 / z
			ctx.lineJoin = 'round'
			ctx.lineCap = 'round'
			for (const id of ids) {
				const path = getCanvasIndicatorPath(editor, id)
				const transform = path && editor.getShapePageTransform(id)
				if (!path || !transform) continue
				const { a, b, c, d, e, f } = transform
				const s = dpr * z
				ctx.setTransform(s * a, s * b, s * c, s * d, s * (e + cx), s * (f + cy))
				ctx.stroke(path)
			}
		},
		[editor, ids]
	)

	return <canvas ref={rCanvas} className="tl-overlays__canvas" aria-hidden="true" />
}

/** Whether the canvas draws this shape's outline; if not, its SVG indicator does. */
export function canDrawOnCanvas(editor: Editor, id: TLShapeId): boolean {
	const shape = editor.getShape(id)
	if (!shape) return true
	const util = editor.getShapeUtil(shape) as ShapeUtil
	return !!util.getIndicatorPath || util.indicator === ShapeUtil.prototype.indicator
}

const fromGeometry = new WeakMap<Geometry2d, Path2D>()
const fromUtil = new WeakMap<TLShape, Path2D>()

/** A shape's outline as a canvas path in its own space, or nothing if it isn't drawn here. */
function getCanvasIndicatorPath(editor: Editor, id: TLShapeId): Path2D | undefined {
	const shape = editor.getShape(id)
	if (!shape || shape.isLocked || !canDrawOnCanvas(editor, id)) return
	const util = editor.getShapeUtil(shape) as ShapeUtil
	if (util.getIndicatorPath) {
		let path = fromUtil.get(shape)
		if (!path) {
			path = util.getIndicatorPath(shape)
			if (path) fromUtil.set(shape, path)
		}
		return path
	}
	const geometry = editor.getShapeGeometry(shape)
	let path = fromGeometry.get(geometry)
	if (!path) {
		path = new Path2D()
		const { vertices, isClosed } = geometry
		vertices.forEach((v, i) => (i ? path!.lineTo(v.x, v.y) : path!.moveTo(v.x, v.y)))
		if (isClosed) path.closePath()
		fromGeometry.set(geometry, path)
	}
	return path
}
