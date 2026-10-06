import { BaseBoxShapeTool, TLShape } from '@lifeboard/canvas-editor'
import { getShapesFrameWouldEnclose } from '../../utils/frames/frames'

/** @public */
export class FrameShapeTool extends BaseBoxShapeTool {
	static override id = 'frame'
	static override initial = 'idle'
	override shapeType = 'frame'

	override onCreate = (shape: TLShape | null): void => {
		if (!shape) return

		const shapesToAddToFrame = getShapesFrameWouldEnclose(this.editor, shape)
		this.editor.reparentShapes(shapesToAddToFrame, shape.id)

		if (this.editor.getInstanceState().isToolLocked) {
			this.editor.setCurrentTool('frame')
		} else {
			this.editor.setCurrentTool('select.idle')
		}
	}
}
