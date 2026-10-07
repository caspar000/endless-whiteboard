import { getGeoType } from '../customGeoTypes'
import { getNewShapeScale } from '../../../utils/dynamicSize'
import {
	Box2d,
	GeoShapeGeoStyle,
	StateNode,
	TLEventHandlers,
	TLGeoShape,
	createShapeId,
	getStarBounds,
} from '@lifeboard/canvas-editor'

export class Pointing extends StateNode {
	static override id = 'pointing'

	markId = ''

	override onPointerUp: TLEventHandlers['onPointerUp'] = () => {
		this.complete()
	}

	override onPointerMove: TLEventHandlers['onPointerMove'] = (info) => {
		if (this.editor.inputs.isDragging) {
			// On the grid when it snaps: the dragged corner snaps as it is resized, so this one must too.
			const originPagePoint = this.editor.snapPointToGrid(this.editor.inputs.originPagePoint)

			const id = createShapeId()

			this.markId = `creating:${id}`

			this.editor.mark(this.markId)

			this.editor
				.createShapes<TLGeoShape>([
					{
						id,
						type: 'geo',
						x: originPagePoint.x,
						y: originPagePoint.y,
						props: {
							w: 1,
							h: 1,
							geo: this.editor.getStyleForNextShape(GeoShapeGeoStyle),
							scale: getNewShapeScale(this.editor),
						},
					},
				])
				.select(id)
				.setCurrentTool('select.resizing', {
					...info,
					target: 'selection',
					handle: 'bottom_right',
					isCreating: true,
					creationCursorOffset: { x: 1, y: 1 },
					onInteractionEnd: 'geo',
				})
		}
	}

	override onCancel: TLEventHandlers['onCancel'] = () => {
		this.cancel()
	}

	override onComplete: TLEventHandlers['onComplete'] = () => {
		this.complete()
	}

	override onInterrupt: TLEventHandlers['onInterrupt'] = () => {
		this.cancel()
	}

	private complete() {
		const { originPagePoint } = this.editor.inputs

		const id = createShapeId()

		this.markId = `creating:${id}`

		this.editor.mark(this.markId)

		this.editor.createShapes<TLGeoShape>([
			{
				id,
				type: 'geo',
				x: originPagePoint.x,
				y: originPagePoint.y,
				props: {
					geo: this.editor.getStyleForNextShape(GeoShapeGeoStyle),
					w: 1,
					h: 1,
					scale: getNewShapeScale(this.editor),
				},
			},
		])

		const shape = this.editor.getShape<TLGeoShape>(id)!
		if (!shape) return

		const custom = getGeoType(shape.props.geo)?.defaultSize
		const bounds =
			shape.props.geo === 'star'
				? getStarBounds(5, 200, 200)
				: shape.props.geo === 'cloud'
				? new Box2d(0, 0, 300, 180)
				: custom
				? new Box2d(0, 0, custom.w, custom.h)
				: new Box2d(0, 0, 200, 200)

		// A clicked shape's default size, at its scale (B10).
		const scale = shape.props.scale
		bounds.set(bounds.x * scale, bounds.y * scale, bounds.w * scale, bounds.h * scale)
		const delta = bounds.center
		const parentTransform = this.editor.getShapeParentTransform(shape)
		if (parentTransform) delta.rot(-parentTransform.rotation())

		this.editor.select(id)
		const corner = this.editor.snapPointToGrid({ x: shape.x - delta.x, y: shape.y - delta.y })
		this.editor.updateShapes<TLGeoShape>([
			{
				id: shape.id,
				type: 'geo',
				x: corner.x,
				y: corner.y,
				props: {
					geo: this.editor.getStyleForNextShape(GeoShapeGeoStyle),
					w: bounds.width,
					h: bounds.height,
				},
			},
		])

		if (this.editor.getInstanceState().isToolLocked) {
			this.parent.transition('idle')
		} else {
			this.editor.setCurrentTool('select', {})
		}
	}

	private cancel() {
		// we should not have created any shapes yet, so no need to bail
		this.parent.transition('idle')
	}
}
