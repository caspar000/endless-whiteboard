import { createShapeId, type Editor, type TLShapeId } from '@lifeboard/canvas'
import { useMemo, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

/**
 * Dragging a shape out of the dock (docs/fork-parity.md B9). Pull a dock button onto the board and the
 * shape it draws appears under the pointer, in the styles the next shape would have, and goes on
 * following the pointer until it's let go, as any shape being moved does (into a frame, snapping and
 * all). A click is still a click: it picks the tool.
 */
export type DockShape = 'frame' | 'note' | 'geo' | 'text'

/** How far, in screen pixels, a press moves before it's a drag. */
const DRAG_START = 6

export function useDockDrag(editor: Editor, kind: DockShape | undefined) {
	const press = useRef<{ x: number; y: number; dragging: boolean } | null>(null)
	// The click a drag ends with isn't a click on the button.
	const dragged = useRef(false)

	return useMemo(() => {
		const pointer = (e: ReactPointerEvent, name: 'pointer_down' | 'pointer_move' | 'pointer_up', shapeId?: TLShapeId) => {
			const shape = shapeId ? editor.getShape(shapeId) : undefined
			editor.dispatch({
				type: 'pointer',
				name,
				...(shape ? { target: 'shape' as const, shape } : { target: 'canvas' as const }),
				point: { x: e.clientX, y: e.clientY, z: e.pressure },
				pointerId: e.pointerId,
				button: 0,
				isPen: e.pointerType === 'pen',
				shiftKey: e.shiftKey,
				altKey: e.altKey,
				ctrlKey: e.metaKey || e.ctrlKey,
			})
		}

		return {
			onPointerDown(e: ReactPointerEvent<HTMLElement>) {
				// Keep focus on the canvas so keyboard shortcuts keep flowing to the editor.
				e.preventDefault()
				dragged.current = false
				if (!kind || e.button !== 0 || editor.getInstanceState().isReadonly) return
				press.current = { x: e.clientX, y: e.clientY, dragging: false }
				e.currentTarget.setPointerCapture(e.pointerId)
			},
			onPointerMove(e: ReactPointerEvent<HTMLElement>) {
				const current = press.current
				if (!current || !kind) return
				if (current.dragging) {
					pointer(e, 'pointer_move')
					return
				}
				if (Math.hypot(e.clientX - current.x, e.clientY - current.y) < DRAG_START) return
				current.dragging = true
				dragged.current = true
				const id = createUnderPointer(editor, kind, editor.screenToPage({ x: e.clientX, y: e.clientY }))
				// Pressed on the new shape, as though it had been there all along: the select tool takes
				// it from here, and moves it as the pointer goes on.
				pointer(e, 'pointer_down', id)
				pointer(e, 'pointer_move')
			},
			onPointerUp(e: ReactPointerEvent<HTMLElement>) {
				const current = press.current
				press.current = null
				if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
				if (!current?.dragging) return
				pointer(e, 'pointer_up')
				const id = editor.getOnlySelectedShape()?.id
				// A text needs its words before it's anything.
				if (kind === 'text' && id) {
					editor.setEditingShape(id)
					editor.setCurrentTool('select.editing_shape')
				}
			},
			onPointerCancel(e: ReactPointerEvent<HTMLElement>) {
				if (press.current?.dragging) editor.cancel()
				press.current = null
				if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
			},
			/** Whether the click that just came was the end of a drag, to be ignored. */
			wasDrag() {
				const was = dragged.current
				dragged.current = false
				return was
			},
		}
	}, [editor, kind])
}

/** A shape of the kind, centred on the page point, selected; one undo step with its moving. */
function createUnderPointer(editor: Editor, kind: DockShape, at: { x: number; y: number }): TLShapeId {
	const id = createShapeId()
	editor.mark('drag out of the dock')
	editor.setCurrentTool('select')
	editor.createShape({
		id,
		type: kind,
		x: at.x,
		y: at.y,
		...(kind === 'geo' && { props: { w: 100, h: 100 } }),
	})
	// Centred whatever size it came out.
	const bounds = editor.getShapePageBounds(id)
	if (bounds) editor.updateShape({ id, type: kind, x: at.x - bounds.w / 2, y: at.y - bounds.h / 2 })
	editor.select(id)
	return id
}
