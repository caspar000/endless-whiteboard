import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { stopEventPropagation, useValue, type Editor, type TLShapeId } from 'tldraw'

/**
 * The floating panel a node shows while it is being edited (the item field editor, the rollup config).
 *
 * Portalled into tldraw's container rather than rendered inside the shape, for two reasons:
 *
 *  1. **Stacking.** Every shape is its own stacking context in tldraw's shape layer, ordered by DOM
 *     order. A panel rendered inside the shape is painted *under* every later shape — it appeared
 *     correctly for one row and was then covered by the neighbouring cards.
 *  2. **Legibility.** Content inside a shape is scaled by the camera, so at 40% zoom the form controls
 *     would be unreadable and untappable. Outside the canvas transform they stay at their natural
 *     size, which is what you want from a form.
 *
 * The trade-off is that position has to be computed rather than inherited — done reactively below, so
 * the panel tracks the shape through pans, zooms and drags.
 */
const PANEL_GAP = 8
const VIEWPORT_MARGIN = 8
/**
 * Below this much room, the panel opens *above* the shape instead of below it.
 *
 * The alternative — always open downward and clamp the top — is what the first version did, and it was
 * tuned for a short panel. The table config is several times taller, so a table near the bottom of the
 * screen put most of its own configuration off-screen and unreachable. Flipping needs no measurement,
 * because the decision comes from the space available rather than from the panel's height.
 */
const MIN_SPACE_BELOW = 260

export function NodeEditorPopover({
	shape,
	editor,
	width,
	children,
}: {
	/**
	 * Only the id is used — deliberately typed that narrowly so this works for *any* shape, including
	 * tldraw's own. That is what lets the properties popover open on a photo or a sticky note.
	 */
	shape: { id: TLShapeId }
	editor: Editor
	/** Panel width in screen pixels; used to keep it inside the viewport. */
	width: number
	children: ReactNode
}) {
	// `useValue` subscribes to the camera and the shape's bounds, so the panel follows the shape.
	// This is a UI concern and deliberately *not* routed through the rollup facts pipeline — it is
	// expected to recompute on camera changes, which is exactly what §4.3 keeps rollups away from.
	const position = useValue(
		'lifeboard:popover-position',
		() => {
			const bounds = editor.getShapePageBounds(shape.id)
			if (!bounds) return null
			const viewport = editor.getViewportScreenBounds()
			const shapeTop = editor.pageToScreen({ x: bounds.x, y: bounds.y })
			const shapeBottom = editor.pageToScreen({ x: bounds.x, y: bounds.y + bounds.h })

			// Horizontally, nudged inward to stay on screen.
			const x = Math.max(
				VIEWPORT_MARGIN,
				Math.min(shapeTop.x, viewport.w - width - VIEWPORT_MARGIN)
			)

			const spaceBelow = viewport.h - shapeBottom.y - PANEL_GAP - VIEWPORT_MARGIN
			const spaceAbove = shapeTop.y - PANEL_GAP - VIEWPORT_MARGIN

			// Flip only when below is genuinely cramped *and* above is roomier, so the panel doesn't
			// oscillate as the shape is nudged around. Either way it gets a `maxHeight` and scrolls
			// internally, so no part of it is ever unreachable.
			if (spaceBelow < MIN_SPACE_BELOW && spaceAbove > spaceBelow) {
				return {
					x,
					anchor: 'above' as const,
					edge: shapeTop.y - PANEL_GAP,
					maxHeight: Math.max(120, spaceAbove),
				}
			}
			return {
				x,
				anchor: 'below' as const,
				edge: Math.max(VIEWPORT_MARGIN, shapeBottom.y + PANEL_GAP),
				maxHeight: Math.max(120, spaceBelow),
			}
		},
		[editor, shape.id, width]
	)

	if (!position) return null

	return createPortal(
		<div
			className="lb-popover"
			style={{
				left: position.x,
				width,
				maxHeight: position.maxHeight,
				...(position.anchor === 'below'
					? { top: position.edge }
					: // Pinned to the shape's top edge and growing upward. `bottom` is measured from the
						// container's bottom, hence the subtraction.
						{ bottom: `calc(100% - ${position.edge}px)` }),
			}}
			// The panel sits outside the canvas but over it, so canvas gestures must not fire from it.
			onPointerDown={stopEventPropagation}
			onTouchStart={stopEventPropagation}
			onWheel={stopEventPropagation}
		>
			{children}
		</div>,
		editor.getContainer()
	)
}
