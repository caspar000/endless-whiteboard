import { useEffect } from 'react'
import { Editor } from '../editor/Editor'
import { useEditor } from './useEditor'

/**
 * One-finger zoom on a touch screen (docs/fork-parity.md I6): tap, then tap again and keep the finger
 * down, and dragging it zooms around the spot, in going down and out going up, as a map does.
 *
 * The second touch is held back from the editor until it shows what it is: moving makes it a zoom,
 * which the editor never sees; lifting without moving makes it the second tap of a double tap, and
 * it is handed on as it came. Any other touch goes straight through.
 */
export function useTouchZoom(ref: React.RefObject<HTMLElement | null>) {
	const editor = useEditor()
	useEffect(() => {
		const element = ref.current
		if (!element) return
		return listenForTouchZoom(editor, element)
	}, [editor, ref])
}

/** Taps further apart than this, in time or space, are two taps, not a double tap. */
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_DISTANCE = 40
/** How far a quick touch may wander and still count as a tap. */
const TAP_SLOP = 10
const TAP_MS = 250
/** How far the held second touch moves before it is a zoom. */
const ZOOM_START = 8
/** Pixels of drag per doubling of the zoom. */
const PIXELS_PER_DOUBLING = 150

type Tap = { time: number; x: number; y: number }
type Held = {
	pointerId: number
	target: EventTarget
	down: PointerEvent
	x: number
	y: number
	zooming: boolean
	startZoom: number
	/** The page point under the touch, which stays put as the zoom changes. */
	anchor: { x: number; y: number }
}

export function listenForTouchZoom(editor: Editor, element: HTMLElement): () => void {
	const replayed = new WeakSet<Event>()
	const touches = new Map<number, { time: number; x: number; y: number }>()
	let lastTap: Tap | null = null
	let held: Held | null = null

	const onDown = (e: PointerEvent) => {
		if (e.pointerType !== 'touch' || replayed.has(e)) return
		touches.set(e.pointerId, { time: e.timeStamp, x: e.clientX, y: e.clientY })
		// A second finger is a pinch: let go of anything held, and hand the held touch on.
		if (held) {
			release()
			return
		}
		if (touches.size !== 1 || !lastTap || editor.getCameraOptions().isLocked) return
		if (e.timeStamp - lastTap.time > DOUBLE_TAP_MS) return
		if (Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) > DOUBLE_TAP_DISTANCE) return
		e.stopPropagation()
		e.preventDefault()
		held = {
			pointerId: e.pointerId,
			target: e.target ?? element,
			down: e,
			x: e.clientX,
			y: e.clientY,
			zooming: false,
			startZoom: editor.getZoomLevel(),
			anchor: editor.screenToPage({ x: e.clientX, y: e.clientY }),
		}
		lastTap = null
	}

	const onMove = (e: PointerEvent) => {
		if (!held || e.pointerId !== held.pointerId || replayed.has(e)) return
		e.stopPropagation()
		const dy = e.clientY - held.y
		if (!held.zooming && Math.abs(dy) < ZOOM_START) return
		held.zooming = true
		zoomTo(held, held.startZoom * 2 ** (dy / PIXELS_PER_DOUBLING))
	}

	const onUp = (e: PointerEvent) => {
		if (e.pointerType !== 'touch' || replayed.has(e)) return
		const start = touches.get(e.pointerId)
		touches.delete(e.pointerId)
		if (held && e.pointerId === held.pointerId) {
			e.stopPropagation()
			if (held.zooming) held = null
			else {
				// Lifted without moving: the second tap of a double tap, which the editor should have.
				release()
				replay(e, 'pointerup')
			}
			return
		}
		const isTap =
			!!start &&
			touches.size === 0 &&
			e.timeStamp - start.time < TAP_MS &&
			Math.hypot(e.clientX - start.x, e.clientY - start.y) < TAP_SLOP
		lastTap = isTap ? { time: e.timeStamp, x: e.clientX, y: e.clientY } : null
	}

	const onCancel = (e: PointerEvent) => {
		touches.delete(e.pointerId)
		if (held && e.pointerId === held.pointerId) held = null
	}

	/** Hands the held touch to the editor after all, as it came. */
	const release = () => {
		if (!held) return
		const { down, target } = held
		held = null
		const event = new PointerEvent('pointerdown', down)
		replayed.add(event)
		target.dispatchEvent(event)
	}

	const replay = (e: PointerEvent, type: string) => {
		const event = new PointerEvent(type, e)
		replayed.add(event)
		;(e.target ?? element).dispatchEvent(event)
	}

	const zoomTo = (gesture: Held, zoom: number) => {
		const steps = editor.getCameraOptions().zoomSteps
		const z = Math.min(steps[steps.length - 1]!, Math.max(steps[0]!, zoom))
		const { screenBounds } = editor.getInstanceState()
		const at = { x: gesture.x - screenBounds.x, y: gesture.y - screenBounds.y }
		// Keep the touched spot where the finger first came down.
		editor.setCamera({ x: at.x / z - gesture.anchor.x, y: at.y / z - gesture.anchor.y, z })
	}

	element.addEventListener('pointerdown', onDown, true)
	element.addEventListener('pointermove', onMove, true)
	element.addEventListener('pointerup', onUp, true)
	element.addEventListener('pointercancel', onCancel, true)
	return () => {
		element.removeEventListener('pointerdown', onDown, true)
		element.removeEventListener('pointermove', onMove, true)
		element.removeEventListener('pointerup', onUp, true)
		element.removeEventListener('pointercancel', onCancel, true)
	}
}
