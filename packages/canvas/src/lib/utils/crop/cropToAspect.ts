import { Editor, TLImageShape, Vec2d } from '@lifeboard/canvas-editor'

/**
 * Crops an image to an aspect ratio (docs/fork-parity.md B5): the largest region of that shape,
 * centred on the picture, at the scale it is shown, without the picture moving on the board.
 * `'original'` is the picture's own shape, uncropped.
 *
 * @public
 */
export function cropImageToAspect(editor: Editor, id: TLImageShape['id'], aspect: number | 'original') {
	const shape = editor.getShape<TLImageShape>(id)
	if (!shape) return
	const crop = shape.props.crop ?? { topLeft: { x: 0, y: 0 }, bottomRight: { x: 1, y: 1 } }
	const cropW = crop.bottomRight.x - crop.topLeft.x
	const cropH = crop.bottomRight.y - crop.topLeft.y
	if (cropW <= 0 || cropH <= 0) return
	// The whole picture, at the scale it is shown.
	const fullW = shape.props.w / cropW
	const fullH = shape.props.h / cropH
	const ratio = aspect === 'original' ? fullW / fullH : aspect
	const w = fullW / fullH > ratio ? fullH * ratio : fullW
	const h = w / ratio
	const topLeft = { x: (fullW - w) / 2 / fullW, y: (fullH - h) / 2 / fullH }
	const bottomRight = { x: topLeft.x + w / fullW, y: topLeft.y + h / fullH }
	// Where the whole picture's corner is, so the cropped region stays where it is on it.
	const origin = new Vec2d(shape.x, shape.y).sub(
		new Vec2d(crop.topLeft.x * fullW, crop.topLeft.y * fullH).rot(shape.rotation)
	)
	const position = origin.add(new Vec2d(topLeft.x * fullW, topLeft.y * fullH).rot(shape.rotation))
	editor.mark('crop to aspect')
	editor.updateShape<TLImageShape>({
		id,
		type: 'image',
		x: position.x,
		y: position.y,
		props: { w, h, crop: { topLeft, bottomRight } },
	})
}
