import {
	StateNode,
	TLArrowEnd,
	TLArrowShape,
	TLEventHandlers,
	TLPointerEventInfo,
	getArrowTerminal,
} from '@lifeboard/canvas-editor'
import { isDragAlongArrow, pressedOnArrowLabel } from './DraggingArrowLabel'

export class PointingHandle extends StateNode {
	static override id = 'pointing_handle'

	info = {} as TLPointerEventInfo & { target: 'handle' }

	override onEnter = (info: TLPointerEventInfo & { target: 'handle' }) => {
		this.info = info

		const initialTerminal =
			info.shape.type === 'arrow' && (info.handle.id === 'start' || info.handle.id === 'end')
				? getArrowTerminal(this.editor, info.shape as TLArrowShape, info.handle.id as TLArrowEnd)
				: undefined

		if (initialTerminal?.type === 'binding') {
			this.editor.setHintingShapes([initialTerminal.boundShapeId])
		}

		this.editor.updateInstanceState(
			{ cursor: { type: 'grabbing', rotation: 0 } },
			{ ephemeral: true }
		)
	}

	override onExit = () => {
		this.editor.setHintingShapes([])
		this.editor.updateInstanceState(
			{ cursor: { type: 'default', rotation: 0 } },
			{ ephemeral: true }
		)
	}

	override onPointerUp: TLEventHandlers['onPointerUp'] = () => {
		this.parent.transition('idle', this.info)
	}

	override onPointerMove: TLEventHandlers['onPointerMove'] = () => {
		if (this.editor.inputs.isDragging) {
			// An arrow's middle handle sits under its label: dragging along the arrow slides the label
			// (B2), dragging across it bends the arrow as before.
			if (this.info.handle.id === 'middle' && pressedOnArrowLabel(this.editor) && isDragAlongArrow(this.editor)) {
				this.parent.transition('dragging_arrow_label', this.info)
				return
			}
			this.parent.transition('dragging_handle', this.info)
		}
	}

	override onCancel: TLEventHandlers['onCancel'] = () => {
		this.cancel()
	}

	override onComplete: TLEventHandlers['onComplete'] = () => {
		this.cancel()
	}

	override onInterrupt = () => {
		this.cancel()
	}

	private cancel() {
		this.parent.transition('idle')
	}
}
