import {
	Group2d,
	StateNode,
	TLArrowShape,
	TLEventHandlers,
	TLShapeId,
	Vec2d,
	type Editor,
} from '@lifeboard/canvas-editor'
import { getArrowLabelPosition } from '../../../shapes/arrow/ArrowShapeUtil'

/**
 * Dragging a selected arrow's label along it (docs/fork-parity.md B2). Entered from a press on the
 * label that turns into a drag, so a click or double-click on the label is still a click (and a
 * double-click still edits it).
 */
export class DraggingArrowLabel extends StateNode {
	static override id = 'dragging_arrow_label'

	private arrowId: TLShapeId | null = null
	private markId = ''

	override onEnter = () => {
		const arrow = this.editor.getOnlySelectedShape()
		this.arrowId = arrow?.id ?? null
		this.markId = `dragging arrow label ${Date.now()}`
		this.editor.mark(this.markId)
		this.update()
	}

	override onPointerMove: TLEventHandlers['onPointerMove'] = () => {
		this.update()
	}

	override onPointerUp: TLEventHandlers['onPointerUp'] = () => {
		this.parent.transition('idle')
	}

	override onCancel: TLEventHandlers['onCancel'] = () => {
		this.editor.bailToMark(this.markId)
		this.parent.transition('idle')
	}

	override onComplete: TLEventHandlers['onComplete'] = () => {
		this.parent.transition('idle')
	}

	private update() {
		const arrow = this.arrowId && this.editor.getShape<TLArrowShape>(this.arrowId)
		if (!arrow) return
		const geometry = this.editor.getShapeGeometry<Group2d>(arrow)
		const point = this.editor.getPointInShapeSpace(arrow, this.editor.inputs.currentPagePoint)
		// Kept off the very ends, where the label would sit on an arrowhead or a shape.
		const labelPosition = Math.min(0.95, Math.max(0.05, getArrowLabelPosition(geometry.children[0]!, point)))
		this.editor.updateShape<TLArrowShape>({ id: arrow.id, type: 'arrow', props: { labelPosition } })
	}
}

/** Whether the press that started this drag was on the label of the one selected arrow. */
export function pressedOnArrowLabel(editor: Editor): boolean {
	const arrow = editor.getOnlySelectedShape()
	if (!arrow || !editor.isShapeOfType<TLArrowShape>(arrow, 'arrow') || editor.isShapeOrAncestorLocked(arrow)) {
		return false
	}
	const label = editor.getShapeGeometry<Group2d>(arrow).children[1]
	if (!label?.isLabel) return false
	return label.bounds.containsPoint(editor.getPointInShapeSpace(arrow, editor.inputs.originPagePoint))
}

/**
 * Whether the drag so far runs more along the selected arrow, at its label, than across it: the
 * difference between sliding the label and bending the arrow.
 */
export function isDragAlongArrow(editor: Editor): boolean {
	const arrow = editor.getOnlySelectedShape()
	if (!arrow) return false
	const geometry = editor.getShapeGeometry<Group2d>(arrow)
	const label = geometry.children[1]
	const body = geometry.children[0]
	if (!label || !body) return false
	const from = editor.getPointInShapeSpace(arrow, editor.inputs.originPagePoint)
	const to = editor.getPointInShapeSpace(arrow, editor.inputs.currentPagePoint)
	// The arrow's direction at the label: between the two body points either side of it.
	const t = getArrowLabelPosition(body, label.center)
	const length = body.vertices.length
	const index = Math.min(length - 1, Math.max(1, Math.round(t * (length - 1))))
	const a = body.vertices[index - 1]!
	const b = body.vertices[index]!
	const along = Vec2d.Sub(b, a).uni()
	const drag = Vec2d.Sub(to, from)
	return Math.abs(Vec2d.Dpr(drag, along)) >= Math.abs(Vec2d.Cpr(drag, along))
}
