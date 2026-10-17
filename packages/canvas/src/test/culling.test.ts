import { createShapeId, react } from '@lifeboard/canvas-editor'
import { TestEditor } from './TestEditor'

let editor: TestEditor
beforeEach(() => {
	editor = new TestEditor()
})
afterEach(() => {
	editor?.dispose()
})

const isCulled = (id: ReturnType<typeof createShapeId>) =>
	editor.getRenderingShapes().find((s) => s.id === id)!.isCulled

it('shows what a quick pan brings into view while the camera is still moving', () => {
	const far = createShapeId('far')
	editor.createShapes([{ id: far, type: 'geo', x: 3000, y: 100, props: { w: 100, h: 100 } }])
	editor.setCamera({ x: -10, y: 0, z: 1 })
	editor.setCamera({ x: -2900, y: 0, z: 1 })
	expect(editor.getCameraState()).toBe('moving')
	expect(isCulled(far)).toBe(false)
})

it('keeps pictures shown half a screen past the edge, other shapes 100px', () => {
	const picture = createShapeId('picture')
	const box = createShapeId('box')
	// The viewport is 1080 wide; both start 400px past its right edge.
	editor.createShapes([
		{ id: picture, type: 'image', x: 1480, y: 100, props: { w: 100, h: 100 } },
		{ id: box, type: 'geo', x: 1480, y: 300, props: { w: 100, h: 100 } },
	])
	editor.setCamera({ x: 0, y: 0, z: 1 })
	expect(isCulled(picture)).toBe(false)
	expect(isCulled(box)).toBe(true)
})

it('does not rebuild the list of shapes to render when the camera moves', () => {
	editor.createShapes(
		Array.from({ length: 20 }, (_, i) => ({
			type: 'geo',
			x: i * 300,
			y: 0,
			props: { w: 100, h: 100 },
		}))
	)
	let rebuilds = 0
	const stop = react('count rebuilds', () => {
		editor.getRenderingShapeList()
		rebuilds++
	})
	for (let i = 1; i <= 30; i++) editor.setCamera({ x: -i * 150, y: -i * 40, z: 1 })
	jest.advanceTimersByTime(500)
	stop()
	// The first run is the subscription itself.
	expect(rebuilds).toBe(1)
})

it('leaves the culling bounds alone while a moving viewport stays inside them', () => {
	editor.setCamera({ x: 0, y: 0, z: 1 })
	editor.setCamera({ x: -2000, y: 0, z: 1 })
	expect(editor.getCameraState()).toBe('moving')
	const expanded = editor.getRenderingBoundsExpanded()
	expect(expanded.contains(editor.getViewportPageBounds())).toBe(true)
	editor.setCamera({ x: -2020, y: -10, z: 1 })
	editor.setCamera({ x: -2040, y: -20, z: 1 })
	expect(editor.getRenderingBoundsExpanded()).toBe(expanded)
})

it('culls exactly again once the camera stops', () => {
	const near = createShapeId('near')
	editor.createShapes([{ id: near, type: 'geo', x: 0, y: 0, props: { w: 100, h: 100 } }])
	editor.setCamera({ x: 0, y: 0, z: 1 })
	// 300px past the shape: outside the 100px margin, but inside the slack a moving camera keeps.
	editor.setCamera({ x: -400, y: 0, z: 1 })
	editor.setCamera({ x: -500, y: 0, z: 1 })
	expect(editor.getCameraState()).toBe('moving')
	expect(isCulled(near)).toBe(false)
	jest.advanceTimersByTime(500)
	expect(editor.getCameraState()).toBe('idle')
	expect(isCulled(near)).toBe(true)
})

it('does not rebuild the list of shapes to render when a shape moves', () => {
	const moving = createShapeId('moving')
	editor.createShapes([
		{ id: moving, type: 'geo', x: 0, y: 0, props: { w: 100, h: 100 } },
		{ type: 'geo', x: 300, y: 0, props: { w: 100, h: 100 } },
	])
	let rebuilds = 0
	const stop = react('count rebuilds', () => {
		editor.getRenderingShapeList()
		rebuilds++
	})
	for (let i = 1; i <= 20; i++) editor.updateShape({ id: moving, type: 'geo', x: i * 10, y: i * 5 })
	expect(rebuilds).toBe(1)
	// What the list does carry still reaches it.
	editor.updateShape({ id: moving, type: 'geo', opacity: 0.5 })
	stop()
	expect(rebuilds).toBe(2)
})
