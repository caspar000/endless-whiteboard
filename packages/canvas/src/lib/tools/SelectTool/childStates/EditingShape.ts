import {
	Group2d,
	StateNode,
	TLArrowShape,
	TLEventHandlers,
	TLFrameShape,
	TLGeoShape,
} from '@lifeboard/canvas-editor'
import { getHitShapeOnCanvasPointerDown } from '../../selection-logic/getHitShapeOnCanvasPointerDown'
import { updateHoveredId } from '../../selection-logic/updateHoveredId'

export class EditingShape extends StateNode {
	static override id = 'editing_shape'

	/**
	 * The tool that made the shape being edited, when that tool should come back after: with the tool
	 * locked, the text tool stays the text tool, so a click starts the next text (docs/fork-parity.md B13).
	 */
	private returnToTool: string | null = null

	override onEnter = (info?: { returnToTool?: string }) => {
		this.returnToTool = info?.returnToTool ?? null
		const editingShape = this.editor.getEditingShape()
		if (!editingShape) throw Error('Entered editing state without an editing shape')
		updateHoveredId(this.editor)
		this.editor.select(editingShape)
	}

	override onExit = () => {
		const { editingShapeId } = this.editor.getCurrentPageState()
		if (!editingShapeId) return

		// Clear the editing shape
		this.editor.setEditingShape(null)

		const shape = this.editor.getShape(editingShapeId)!
		const util = this.editor.getShapeUtil(shape)

		// Check for changes on editing end
		util.onEditEnd?.(shape)

		setTimeout(() => {
			this.editor.updateViewportScreenBounds()
		}, 500)
	}

	override onPointerMove: TLEventHandlers['onPointerMove'] = (info) => {
		switch (info.target) {
			case 'shape':
			case 'canvas': {
				updateHoveredId(this.editor)
				return
			}
		}
	}
	override onPointerDown: TLEventHandlers['onPointerDown'] = (info) => {
		switch (info.target) {
			case 'canvas': {
				const hitShape = getHitShapeOnCanvasPointerDown(this.editor)
				if (hitShape) {
					this.onPointerDown({
						...info,
						shape: hitShape,
						target: 'shape',
					})
					return
				}
				break
			}
			case 'shape': {
				const { shape } = info
				const editingShape = this.editor.getEditingShape()

				if (!editingShape) {
					throw Error('Expected an editing shape!')
				}

				if (shape.type === editingShape.type) {
					// clicked a shape of the same type as the editing shape
					if (
						this.editor.isShapeOfType<TLGeoShape>(shape, 'geo') ||
						this.editor.isShapeOfType<TLArrowShape>(shape, 'arrow')
					) {
						// for shapes with labels, check to see if the click was inside of the shape's label
						const geometry = this.editor.getShapeUtil(shape).getGeometry(shape) as Group2d
						const labelGeometry = geometry.children[1]
						if (labelGeometry) {
							const pointInShapeSpace = this.editor.getPointInShapeSpace(
								shape,
								this.editor.inputs.currentPagePoint
							)
							if (labelGeometry.bounds.containsPoint(pointInShapeSpace)) {
								// it's a hit to the label!
								if (shape.id === editingShape.id) {
									// If we clicked on the editing geo / arrow shape's label, do nothing
									return
								} else {
									this.parent.transition('pointing_shape', info)
									return
								}
							}
						}
					} else {
						if (shape.id === editingShape.id) {
							// If we clicked on a frame, while editing its heading, cancel editing
							if (this.editor.isShapeOfType<TLFrameShape>(shape, 'frame')) {
								this.editor.setEditingShape(null)
							}
							// If we clicked on the editing shape (which isn't a shape with a label), do nothing
						} else {
							// But if we clicked on a different shape of the same type, transition to pointing_shape instead
							this.parent.transition('pointing_shape', info)
							return
						}
						return
					}
				} else {
					// clicked a different kind of shape
				}
				break
			}
		}

		// still here? Cancel editing and transition back to select idle
		this.leave(info)
		// then feed the pointer down event back into the state chart as if it happened in that state
		this.editor.root.handleEvent(info)
	}

	override onComplete: TLEventHandlers['onComplete'] = (info) => {
		this.leave(info)
	}

	override onCancel: TLEventHandlers['onCancel'] = (info) => {
		this.leave(info)
	}

	/** Ends the edit: back to select's idle, or to the locked tool that made the shape. */
	private leave(info: object) {
		if (this.returnToTool && this.editor.getInstanceState().isToolLocked) {
			this.editor.setCurrentTool(this.returnToTool, info)
		} else {
			this.parent.transition('idle', info)
		}
	}
}
