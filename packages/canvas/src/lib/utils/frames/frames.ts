import {
	Box2d,
	createShapeId,
	Editor,
	TLFrameShape,
	TLShape,
	TLShapeId,
	TLShapePartial,
	Vec2d,
	compact,
} from '@lifeboard/canvas-editor'

/**
 * Remove a frame.
 *
 * @param editor - tlraw editor instance.
 * @param ids - Ids of the frames you wish to remove.
 *
 * @public
 */
export function removeFrame(editor: Editor, ids: TLShapeId[]) {
	const frames = compact(
		ids
			.map((id) => editor.getShape<TLFrameShape>(id))
			.filter((f) => f && editor.isShapeOfType<TLFrameShape>(f, 'frame'))
	)
	if (!frames.length) return

	const allChildren: TLShapeId[] = []
	editor.batch(() => {
		frames.map((frame) => {
			const children = editor.getSortedChildIdsForParent(frame.id)
			if (children.length) {
				editor.reparentShapes(children, frame.parentId, frame.index)
				allChildren.push(...children)
			}
		})
		editor.setSelectedShapes(allChildren)
		editor.deleteShapes(ids)
	})
}

/** @internal */
export const DEFAULT_FRAME_PADDING = 50

/**
 * The shapes a frame takes in when it is drawn: unlocked siblings it fully covers, never one of its
 * own ancestors. The frame tool adds them when you let go, and highlights them while you draw (B4).
 *
 * @public
 */
export function getShapesFrameWouldEnclose(editor: Editor, frame: TLShape): TLShapeId[] {
	const bounds = editor.getShapePageBounds(frame)
	if (!bounds) return []
	const ancestorIds = new Set(editor.getShapeAncestors(frame).map((shape) => shape.id))
	return editor
		.getCurrentPageShapes()
		.filter((shape) => {
			if (shape.id === frame.id || shape.isLocked || ancestorIds.has(shape.id)) return false
			if (shape.parentId !== frame.parentId) return false
			const shapeBounds = editor.getShapePageBounds(shape)
			return !!shapeBounds && bounds.contains(shapeBounds)
		})
		.map((shape) => shape.id)
}

/**
 * Puts the selected shapes in a new frame around them, `padding` clear of their edges (B4). The frame
 * goes where the lowest of them was, in their parent if they share one.
 *
 * @public
 */
export function frameSelection(editor: Editor, opts = {} as { padding?: number }): TLShapeId | null {
	const shapes = editor.getSelectedShapes().filter((shape) => !editor.isShapeOrAncestorLocked(shape))
	const boxes = compact(shapes.map((shape) => editor.getShapePageBounds(shape)))
	if (!boxes.length) return null
	const bounds = Box2d.Common(boxes)
	const padding = opts.padding ?? FRAME_SELECTION_PADDING
	const parents = new Set(shapes.map((shape) => shape.parentId))
	const parentId = parents.size === 1 ? shapes[0]!.parentId : editor.getCurrentPageId()
	const lowest = [...shapes].sort((a, b) => (a.index < b.index ? -1 : 1))[0]!
	const id = createShapeId()
	editor.batch(() => {
		editor.createShape<TLFrameShape>({
			id,
			type: 'frame',
			parentId: editor.getCurrentPageId(),
			x: bounds.minX - padding,
			y: bounds.minY - padding,
			props: { w: bounds.width + padding * 2, h: bounds.height + padding * 2 },
		})
		if (parentId !== editor.getCurrentPageId()) editor.reparentShapes([id], parentId)
		// In the lowest shape's place: that shape moves into the frame, so the index is free.
		if (parents.size === 1) editor.updateShape({ id, type: 'frame', index: lowest.index })
		editor.reparentShapes(
			shapes.map((shape) => shape.id),
			id
		)
		editor.select(id)
	})
	return id
}

/** How far a frame made around a selection stands off from it. */
const FRAME_SELECTION_PADDING = 32

/**
 * Fit a frame to its content.
 *
 * @param id - Id of the frame you wish to fit to content.
 * @param editor - tlraw editor instance.
 * @param opts - Options for fitting the frame.
 *
 * @public
 */
export function fitFrameToContent(editor: Editor, id: TLShapeId, opts = {} as { padding: number }) {
	const frame = editor.getShape<TLFrameShape>(id)
	if (!frame) return

	const childIds = editor.getSortedChildIdsForParent(frame.id)
	const children = compact(childIds.map((id) => editor.getShape(id)))
	if (!children.length) return

	const bounds = Box2d.FromPoints(
		children.flatMap((shape) => {
			const geometry = editor.getShapeGeometry(shape.id)
			return editor.getShapeLocalTransform(shape)!.applyToPoints(geometry.vertices)
		})
	)

	const { padding = DEFAULT_FRAME_PADDING } = opts
	const w = bounds.w + 2 * padding
	const h = bounds.h + 2 * padding
	const dx = padding - bounds.minX
	const dy = padding - bounds.minY
	// The shapes already perfectly fit the frame.
	if (dx === 0 && dy === 0 && frame.props.w === w && frame.props.h === h) return

	const diff = new Vec2d(dx, dy).rot(frame.rotation)
	editor.batch(() => {
		const changes: TLShapePartial[] = childIds.map((child) => {
			const shape = editor.getShape(child)!
			return {
				id: shape.id,
				type: shape.type,
				x: shape.x + dx,
				y: shape.y + dy,
			}
		})

		changes.push({
			id: frame.id,
			type: frame.type,
			x: frame.x - diff.x,
			y: frame.y - diff.y,
			props: {
				w,
				h,
			},
		})

		editor.updateShapes(changes)
	})
}
