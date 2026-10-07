import {
	AssetRecordType,
	TLImageAsset,
	TLNoteShape,
	createShapeId,
	toRichText,
} from '@lifeboard/canvas-editor'
import { setImageMaskForTests } from '../lib/shapes/image/seeThrough'
import { getExportOptions } from '../lib/utils/export/exportOptions'
import { TestEditor } from './TestEditor'

/** Phase 1 of the parity work: I5, I10, B13, B14, X4 and X5 (docs/fork-parity.md). */

let editor: TestEditor
beforeEach(() => {
	editor = new TestEditor()
})
afterEach(() => {
	editor.user.updateUserPreferences({
		wheelBehavior: null,
		isZoomDirectionInverted: null,
		canSelectLockedShapes: null,
	})
	editor?.dispose()
})

describe('right-click and drag (I5)', () => {
	it('pans once it moves, and says so, so no menu opens', () => {
		editor.dispatch({ ...rightDownInfo(0, 0) })
		expect(editor.isRightPressPending()).toBe(true)
		editor.pointerMove(50, 40)
		editor.pointerMove(100, 100)
		editor.pointerUp(100, 100, { button: 2 })
		editor.expectCameraToBe(100, 100, 1)
		expect(editor.isRightPressPending()).toBe(false)
		expect(editor.didRightPressPan()).toBe(true)
	})

	it('stays a click when it doesn’t move', () => {
		editor.dispatch({ ...rightDownInfo(10, 10) })
		editor.pointerMove(11, 11)
		editor.pointerUp(11, 11, { button: 2 })
		editor.expectCameraToBe(0, 0, 1)
		expect(editor.didRightPressPan()).toBe(false)
	})

	function rightDownInfo(x: number, y: number) {
		editor.pointerMove(x, y)
		return {
			type: 'pointer' as const,
			name: 'right_click' as const,
			target: 'canvas' as const,
			point: { x, y },
			pointerId: 1,
			button: 2,
			isPen: false,
			shiftKey: false,
			altKey: false,
			ctrlKey: false,
		}
	}
})

describe('the wheel (I10)', () => {
	it('pans by default and zooms when asked to', () => {
		editor.wheel(0, -10)
		editor.expectCameraToBe(0, -10, 1)

		editor.user.updateUserPreferences({ wheelBehavior: 'zoom' })
		editor.setCamera({ x: 0, y: 0, z: 1 })
		editor.wheel(0, 10)
		expect(editor.getZoomLevel()).toBeCloseTo(1.1)
		// Sideways still pans.
		editor.wheel(10, 0)
		expect(editor.getZoomLevel()).toBeCloseTo(1.1)
	})

	it('zooms the other way when inverted', () => {
		editor.user.updateUserPreferences({ wheelBehavior: 'zoom', isZoomDirectionInverted: true })
		editor.wheel(0, 10)
		expect(editor.getZoomLevel()).toBeCloseTo(0.9)
	})
})

describe('selecting locked shapes (I10)', () => {
	const id = createShapeId('locked')
	beforeEach(() => {
		editor.createShapes([{ id, type: 'geo', x: 0, y: 0, isLocked: true, props: { w: 100, h: 100 } }])
	})

	it('a click passes through them by default', () => {
		editor.click(50, 50)
		expect(editor.getSelectedShapeIds()).toEqual([])
	})

	it('a click or a brush selects them when allowed, and they still don’t move', () => {
		editor.user.updateUserPreferences({ canSelectLockedShapes: true })
		editor.click(50, 50)
		expect(editor.getSelectedShapeIds()).toEqual([id])

		editor.selectNone()
		editor.pointerDown(-10, -10).pointerMove(120, 120).pointerUp()
		expect(editor.getSelectedShapeIds()).toEqual([id])

		editor.pointerDown(50, 50).pointerMove(150, 150).pointerUp()
		expect(editor.getShape(id)).toMatchObject({ x: 0, y: 0 })
	})
})

describe('a note resized (B13)', () => {
	it('scales, text and all, from the corner dragged', () => {
		const id = createShapeId('note')
		editor.createShapes([{ id, type: 'note', x: 0, y: 0, props: { richText: toRichText('hi') } }])
		editor.select(id)
		editor.resizeSelection({ scaleX: 2, scaleY: 2 }, 'bottom_right')
		expect(editor.getShape<TLNoteShape>(id)!.props.scale).toBeCloseTo(2)
		expect(editor.getShapePageBounds(id)!.width).toBeCloseTo(400)

		editor.resizeSelection({ scaleX: 0.01, scaleY: 0.01 }, 'bottom_right')
		expect(editor.getShape<TLNoteShape>(id)!.props.scale).toBeCloseTo(0.2)
	})
})

describe('the text tool, locked (B13)', () => {
	it('comes back after each text, so a click starts the next', () => {
		editor.updateInstanceState({ isToolLocked: true })
		editor.setCurrentTool('text')
		editor.click(0, 0)
		editor.expectToBeIn('select.editing_shape')
		editor.updateShapes([
			{ ...editor.getCurrentPageShapes()[0]!, type: 'text', props: { richText: toRichText('one') } },
		])

		// Clicking elsewhere ends that text and starts another.
		editor.click(300, 300)
		editor.expectToBeIn('select.editing_shape')
		expect(editor.getCurrentPageShapes()).toHaveLength(2)

		editor.cancel()
		editor.expectToBeIn('text.idle')
	})

	it('goes back to select when the tool isn’t locked', () => {
		editor.setCurrentTool('text')
		editor.click(0, 0)
		editor.cancel()
		editor.expectToBeIn('select.idle')
	})
})

describe('align centres (B14)', () => {
	it('lines the selection up on both centres at once', () => {
		const a = createShapeId('a')
		const b = createShapeId('b')
		editor.createShapes([
			{ id: a, type: 'geo', x: 0, y: 0, props: { w: 100, h: 100 } },
			{ id: b, type: 'geo', x: 300, y: 200, props: { w: 50, h: 50 } },
		])
		editor.alignShapes([a, b], 'center')
		const centre = (id: typeof a) => editor.getShapePageBounds(id)!.center
		expect(centre(a)).toMatchObject(centre(b))
		expect(centre(a)).toMatchObject({ x: 175, y: 125 })
	})
})

describe('see-through pictures (X5)', () => {
	it('let a click through where nothing is drawn, flipped and cropped as shown', () => {
		const behind = createShapeId('behind')
		const picture = createShapeId('picture')
		const assetId = AssetRecordType.createId('half')
		editor.createAssets([
			{
				id: assetId,
				type: 'image',
				typeName: 'asset',
				props: { w: 200, h: 100, name: 'half.png', isAnimated: false, mimeType: 'image/png', src: '' },
				meta: {},
			},
		])
		editor.createShapes([
			{ id: behind, type: 'geo', x: 0, y: 0, props: { w: 200, h: 100, fill: 'solid' } },
			{ id: picture, type: 'image', x: 0, y: 0, props: { w: 200, h: 100, assetId } },
		])
		// Drawn on its left half only.
		setImageMaskForTests(editor.getAsset(assetId) as TLImageAsset, {
			w: 2,
			h: 1,
			alpha: new Uint8ClampedArray([255, 0]),
		})
		const at = (x: number, y: number) => editor.getShapeAtPoint({ x, y })?.id

		expect(at(50, 50)).toBe(picture)
		expect(at(150, 50)).toBe(behind)

		editor.updateShape({ id: picture, type: 'image', props: { flipX: true } })
		expect(at(50, 50)).toBe(behind)
		expect(at(150, 50)).toBe(picture)

		// Cropped to its right (empty) half, flipped back: nothing there to click.
		editor.updateShape({
			id: picture,
			type: 'image',
			props: { flipX: false, crop: { topLeft: { x: 0.5, y: 0 }, bottomRight: { x: 1, y: 1 } } },
		})
		expect(at(50, 50)).toBe(behind)
	})
})

describe('export options (X4)', () => {
	it('trims to the drawing, at the chosen pixel density', async () => {
		const id = createShapeId('box')
		editor.createShapes([{ id, type: 'geo', x: 0, y: 0, props: { w: 100, h: 50 } }])

		const padded = await editor.getSvg([id])
		expect(padded!.getAttribute('width')).toBe('164')

		// Where the document can lay it out, it's measured; here, the shapes' own bounds.
		const trimmed = await editor.getSvg([id], { padding: 'auto' })
		expect(trimmed!.getAttribute('width')).toBe('100')

		expect(getExportOptions(editor)).toMatchObject({ pixelRatio: 2 })
		expect(getExportOptions(editor).padding).toBeUndefined()
		editor.user.updateUserPreferences({ exportPixelRatio: 3, isExportTrimmed: true })
		expect(getExportOptions(editor)).toMatchObject({ pixelRatio: 3, padding: 'auto' })
		editor.user.updateUserPreferences({ exportPixelRatio: null, isExportTrimmed: null })
	})
})
