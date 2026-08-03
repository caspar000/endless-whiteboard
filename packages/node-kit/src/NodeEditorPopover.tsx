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
			const topLeft = editor.pageToScreen({ x: bounds.x, y: bounds.y + bounds.h })

			// Keep the panel on screen. Horizontally it is nudged inward; vertically its *top* is
			// clamped and the panel itself scrolls (max-height in CSS) rather than being measured and
			// flipped — measuring would mean a layout pass on every camera change.
			const x = Math.max(VIEWPORT_MARGIN, Math.min(topLeft.x, viewport.w - width - VIEWPORT_MARGIN))
			const y = Math.max(VIEWPORT_MARGIN, Math.min(topLeft.y + PANEL_GAP, viewport.h - 120))
			return { x, y }
		},
		[editor, shape.id, width]
	)

	if (!position) return null

	return createPortal(
		<div
			className="lb-popover"
			style={{ left: position.x, top: position.y, width }}
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
