import type { Editor } from '../Editor'

/**
 * Edge scrolling (docs/fork-parity.md I1): while you move shapes, brush, resize or drag a handle, taking
 * the pointer to the edge of the view pans the board that way, faster the closer you are and fastest
 * past the edge, once the pointer has been there a moment (so passing the edge doesn't). The drag
 * goes on following the pointer as the board moves under it.
 */
export class EdgeScrollManager {
	constructor(private readonly editor: Editor) {
		editor.on('tick', this.onTick)
		editor.disposables.add(() => editor.off('tick', this.onTick))
	}

	/** How long the pointer has been in the edge zone, this drag. */
	private waited = 0

	private onTick = (elapsed: number) => {
		const { editor } = this
		const { inputs } = editor
		if (
			!inputs.isDragging ||
			!inputs.isPointing ||
			inputs.isPanning ||
			!editor.isInAny(...EDGE_SCROLLING_STATES) ||
			editor.getCameraOptions().isLocked ||
			!editor.options.edgeScrollSpeed
		) {
			this.waited = 0
			return
		}

		const { screenBounds, isCoarsePointer } = editor.getInstanceState()
		const zone = isCoarsePointer ? COARSE_EDGE : EDGE
		const x = inputs.currentScreenPoint.x - screenBounds.x
		const y = inputs.currentScreenPoint.y - screenBounds.y
		// -1…1 per axis: how far into the zone, towards which edge.
		const push = (at: number, size: number) =>
			at < zone ? -Math.min(1, (zone - at) / zone) : at > size - zone ? Math.min(1, (at - (size - zone)) / zone) : 0
		const dx = push(x, screenBounds.w)
		const dy = push(y, screenBounds.h)
		if (!dx && !dy) {
			this.waited = 0
			return
		}
		this.waited += elapsed
		if (this.waited < DELAY_MS) return

		const camera = editor.getCamera()
		const step = (MAX_SPEED * editor.options.edgeScrollSpeed * Math.min(elapsed, 32)) / 16 / camera.z
		editor.setCamera({ x: camera.x - dx * step, y: camera.y - dy * step, z: camera.z })

		// The same pointer, again, so the drag follows the board moving under it.
		editor.dispatch({
			type: 'pointer',
			target: 'canvas',
			name: 'pointer_move',
			point: inputs.currentScreenPoint.clone(),
			pointerId: 0,
			button: 0,
			isPen: inputs.isPen,
			shiftKey: inputs.shiftKey,
			altKey: inputs.altKey,
			ctrlKey: inputs.ctrlKey,
		})
	}
}

const EDGE_SCROLLING_STATES = [
	'select.translating',
	'select.brushing',
	'select.scribble_brushing',
	'select.resizing',
	'select.dragging_handle',
] as const

/** How close to the edge, in screen pixels, before the board starts to move. */
const EDGE = 16
const COARSE_EDGE = 32
/** How long the pointer stays at the edge before the board moves. */
const DELAY_MS = 200
/** Screen pixels per 16ms at the very edge and beyond. */
const MAX_SPEED = 14
