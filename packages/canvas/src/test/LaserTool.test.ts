import { TestEditor } from './TestEditor'

let editor: TestEditor
beforeEach(() => {
	editor = new TestEditor()
})
afterEach(() => {
	editor?.dispose()
})

const tick = (ms: number) => {
	for (let t = 0; t < ms; t += 16) editor.emit('tick', 16)
}
const trails = () => editor.getInstanceState().scribbles

/** Draws one laser stroke of twenty points from x. */
function stroke(x: number) {
	editor.setCurrentTool('laser')
	editor.pointerDown(x, 0)
	for (let i = 1; i <= 20; i++) {
		editor.pointerMove(x + i * 10, i * 5)
		tick(16)
	}
	editor.pointerUp()
}

describe('Laser tool (B12)', () => {
	it('keeps the whole trail while you point, across strokes, then fades it as one', () => {
		stroke(0)
		tick(600)
		stroke(400)
		// Both strokes, whole: nothing has been eaten from their tails.
		expect(trails()).toHaveLength(2)
		const lengths = trails().map((s) => s.points.length)
		tick(1000)
		expect(trails().map((s) => s.points.length)).toEqual(lengths)
		expect(trails()[0]!.opacity).toBe(0.7)

		// A moment after the last one, they fade together and go.
		tick(450)
		const [a, b] = trails()
		expect(a!.opacity).toBeLessThan(0.7)
		expect(a!.opacity).toBeCloseTo(b!.opacity)
		tick(500)
		expect(trails()).toHaveLength(0)
	})
})
