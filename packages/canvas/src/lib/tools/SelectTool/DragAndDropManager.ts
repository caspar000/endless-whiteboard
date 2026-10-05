import { Editor, TLShape, TLShapeId, Vec2d, compact } from '@lifeboard/canvas-editor'

const LAG_DURATION = 100

/** @public */
export class DragAndDropManager {
	constructor(public editor: Editor) {
		editor.disposables.add(this.dispose)
	}

	prevDroppingShapeId: TLShapeId | null = null

	droppingNodeTimer: ReturnType<typeof setTimeout> | null = null

	first = true

	/** Where the pointer was at the last update, to tell a move from a repeat. */
	private lastPoint = new Vec2d()

	updateDroppingNode(movingShapes: TLShape[], cb: () => void) {
		if (this.first) {
			this.prevDroppingShapeId =
				this.editor.getDroppingOverShape(this.editor.inputs.originPagePoint, movingShapes)?.id ??
				null
			this.first = false
		}

		// Shapes still over the same target, and the pointer moved: tell it, on this frame.
		const point = this.editor.inputs.currentPagePoint
		if (this.prevDroppingShapeId && !point.equals(this.lastPoint)) {
			const target = this.editor.getShape(this.prevDroppingShapeId)
			const shapes = compact(movingShapes.map((shape) => this.editor.getShape(shape.id)))
			if (target) this.hint(target, this.editor.getShapeUtil(target).onDragShapesOver?.(target, shapes))
		}
		this.lastPoint = point.clone()

		if (this.droppingNodeTimer === null) {
			this.setDragTimer(movingShapes, LAG_DURATION * 10, cb)
		} else if (this.editor.inputs.pointerVelocity.len() > 0.5) {
			clearInterval(this.droppingNodeTimer)
			this.setDragTimer(movingShapes, LAG_DURATION, cb)
		}
	}

	private setDragTimer(movingShapes: TLShape[], duration: number, cb: () => void) {
		this.droppingNodeTimer = setTimeout(() => {
			this.editor.batch(() => {
				this.handleDrag(this.editor.inputs.currentPagePoint, movingShapes, cb)
			})
			this.droppingNodeTimer = null
		}, duration)
	}

	private handleDrag(point: Vec2d, movingShapes: TLShape[], cb?: () => void) {
		movingShapes = compact(movingShapes.map((shape) => this.editor.getShape(shape.id)))

		const nextDroppingShapeId = this.editor.getDroppingOverShape(point, movingShapes)?.id ?? null

		// is the next dropping shape id different than the last one?
		if (nextDroppingShapeId === this.prevDroppingShapeId) {
			return
		}

		// the old previous one
		const { prevDroppingShapeId } = this

		const prevDroppingShape = prevDroppingShapeId && this.editor.getShape(prevDroppingShapeId)
		const nextDroppingShape = nextDroppingShapeId && this.editor.getShape(nextDroppingShapeId)

		// Even if we don't have a next dropping shape id (i.e. if we're dropping
		// onto the page) set the prev to the current, to avoid repeat calls to
		// the previous parent's onDragShapesOut

		if (prevDroppingShape) {
			this.editor.getShapeUtil(prevDroppingShape).onDragShapesOut?.(prevDroppingShape, movingShapes)
		}

		if (nextDroppingShape) {
			this.hint(
				nextDroppingShape,
				this.editor.getShapeUtil(nextDroppingShape).onDragShapesIn?.(nextDroppingShape, movingShapes)
			)
		} else {
			// If we're dropping onto the page, then clear hinting ids
			this.editor.setHintingShapes([])
		}

		cb?.()

		// next -> curr
		this.prevDroppingShapeId = nextDroppingShapeId
	}

	private hint(target: TLShape, result: { shouldHint: boolean } | void) {
		if (result?.shouldHint) this.editor.setHintingShapes([target.id])
	}

	dropShapes(shapes: TLShape[]) {
		const { prevDroppingShapeId } = this

		this.handleDrag(this.editor.inputs.currentPagePoint, shapes)

		if (prevDroppingShapeId) {
			const shape = this.editor.getShape(prevDroppingShapeId)
			if (!shape) return
			const util = this.editor.getShapeUtil(shape)
			// Only shapes the target can take arrive; with none, there is no drop.
			const receivable = shapes.filter((s) => util.canReceiveNewChildrenOfType(shape, s.type))
			if (receivable.length > 0) util.onDropShapesOver?.(shape, receivable)
		}
	}

	clear() {
		this.prevDroppingShapeId = null

		if (this.droppingNodeTimer !== null) {
			clearInterval(this.droppingNodeTimer)
		}

		this.droppingNodeTimer = null
		this.editor.setHintingShapes([])
		this.first = true
	}

	dispose = () => {
		this.clear()
	}
}
