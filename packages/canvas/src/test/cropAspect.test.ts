import { AssetRecordType, TLImageShape, createShapeId } from '@lifeboard/canvas-editor'
import { cropImageToAspect } from '../lib/utils/crop/cropToAspect'
import { TestEditor } from './TestEditor'

let editor: TestEditor
const id = createShapeId('photo')

beforeEach(() => {
	editor = new TestEditor()
	const assetId = AssetRecordType.createId('photo')
	editor.createAssets([
		{
			id: assetId,
			type: 'image',
			typeName: 'asset',
			props: { w: 400, h: 200, name: 'photo.png', isAnimated: false, mimeType: 'image/png', src: '' },
			meta: {},
		},
	])
	editor.createShapes([{ id, type: 'image', x: 100, y: 100, props: { w: 400, h: 200, assetId } }])
})

const page = () => {
	const b = editor.getShapePageBounds(id)!
	return [b.minX, b.minY, b.width, b.height].map((n) => Math.round(n))
}

describe('cropping to an aspect ratio (B5)', () => {
	it('takes the largest centred square, and the picture stays where it is', () => {
		cropImageToAspect(editor, id, 1)
		const shape = editor.getShape<TLImageShape>(id)!
		expect(shape.props.crop).toEqual({ topLeft: { x: 0.25, y: 0 }, bottomRight: { x: 0.75, y: 1 } })
		// The square is the middle of the 400×200 picture: 100 in from its left edge.
		expect(page()).toEqual([200, 100, 200, 200])
	})

	it('goes back to the whole picture with Original, from any crop', () => {
		cropImageToAspect(editor, id, 16 / 9)
		cropImageToAspect(editor, id, 'original')
		expect(editor.getShape<TLImageShape>(id)!.props.crop).toEqual({ topLeft: { x: 0, y: 0 }, bottomRight: { x: 1, y: 1 } })
		expect(page()).toEqual([100, 100, 400, 200])
	})
})
