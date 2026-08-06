import { describe, expect, it } from 'vitest'
import { applyBackgroundMask, estimateTolerance, sampleBorderColour } from './removeBackground'

/** A `width`×`height` RGBA buffer filled with one opaque colour. */
function image(width: number, height: number, [r, g, b]: [number, number, number]) {
	const data = new Uint8ClampedArray(width * height * 4)
	for (let i = 0; i < width * height; i++) {
		data[i * 4] = r
		data[i * 4 + 1] = g
		data[i * 4 + 2] = b
		data[i * 4 + 3] = 255
	}
	return data
}

function fillRect(
	data: Uint8ClampedArray,
	width: number,
	rect: { x: number; y: number; w: number; h: number },
	[r, g, b]: [number, number, number]
) {
	for (let y = rect.y; y < rect.y + rect.h; y++) {
		for (let x = rect.x; x < rect.x + rect.w; x++) {
			const p = (y * width + x) * 4
			data[p] = r
			data[p + 1] = g
			data[p + 2] = b
			data[p + 3] = 255
		}
	}
}

const alphaAt = (data: Uint8ClampedArray, width: number, x: number, y: number) =>
	data[(y * width + x) * 4 + 3]!

const WHITE: [number, number, number] = [255, 255, 255]
const RED: [number, number, number] = [220, 40, 40]

describe('sampleBorderColour', () => {
	it('takes the dominant border colour, not the average', () => {
		const data = image(20, 20, WHITE)
		// A dark object clipping one edge. Averaging would give grey and match neither.
		fillRect(data, 20, { x: 0, y: 8, w: 3, h: 4 }, [0, 0, 0])
		const bg = sampleBorderColour(data, 20, 20)
		expect(bg.r).toBeGreaterThan(240)
		expect(bg.g).toBeGreaterThan(240)
		expect(bg.b).toBeGreaterThan(240)
	})
})

describe('estimateTolerance', () => {
	it('stays low for a flat background and rises for a noisy one', () => {
		const flat = image(30, 30, WHITE)
		const flatTolerance = estimateTolerance(flat, 30, 30, sampleBorderColour(flat, 30, 30))

		const noisy = image(30, 30, WHITE)
		for (let x = 0; x < 30; x++) {
			const p = x * 4
			noisy[p] = 255 - ((x * 7) % 60)
			noisy[p + 1] = 255 - ((x * 5) % 60)
			noisy[p + 2] = 255 - ((x * 3) % 60)
		}
		const noisyTolerance = estimateTolerance(noisy, 30, 30, sampleBorderColour(noisy, 30, 30))

		expect(noisyTolerance).toBeGreaterThan(flatTolerance)
		// Bounded at both ends, so one click never does nothing and never eats the picture.
		expect(flatTolerance).toBeGreaterThanOrEqual(0.08)
		expect(noisyTolerance).toBeLessThanOrEqual(0.35)
	})
})

describe('applyBackgroundMask', () => {
	it('clears the background and leaves the subject alone', () => {
		const data = image(40, 40, WHITE)
		fillRect(data, 40, { x: 12, y: 12, w: 16, h: 16 }, RED)

		const { removed } = applyBackgroundMask(data, 40, 40)

		expect(alphaAt(data, 40, 0, 0)).toBe(0)
		expect(alphaAt(data, 40, 39, 39)).toBe(0)
		expect(alphaAt(data, 40, 20, 20)).toBe(255)
		// 40² minus the 16² square, give or take the soft edge.
		expect(removed).toBeGreaterThan(0.7)
		expect(removed).toBeLessThan(0.95)
	})

	it('keeps a background-coloured region the border cannot reach', () => {
		// The whole point of flood filling rather than colour-keying: a white shirt inside the subject
		// survives, because no path of background-coloured pixels reaches it.
		const data = image(40, 40, WHITE)
		fillRect(data, 40, { x: 10, y: 10, w: 20, h: 20 }, RED)
		fillRect(data, 40, { x: 17, y: 17, w: 6, h: 6 }, WHITE)

		applyBackgroundMask(data, 40, 40)

		expect(alphaAt(data, 40, 0, 0)).toBe(0)
		expect(alphaAt(data, 40, 20, 20)).toBe(255)
	})

	it('does not leak through a one-pixel border', () => {
		// Four-connected, not eight: a diagonal leak through an antialiased hairline is how a fill
		// escapes a framed screenshot and empties the whole image.
		const data = image(30, 30, RED)
		fillRect(data, 30, { x: 0, y: 0, w: 30, h: 1 }, WHITE)
		fillRect(data, 30, { x: 0, y: 29, w: 30, h: 1 }, WHITE)
		fillRect(data, 30, { x: 0, y: 0, w: 1, h: 30 }, WHITE)
		fillRect(data, 30, { x: 29, y: 0, w: 1, h: 30 }, WHITE)

		const { removed } = applyBackgroundMask(data, 30, 30)

		expect(alphaAt(data, 30, 15, 15)).toBe(255)
		// Only the frame: 30² − 28² out of 30².
		expect(removed).toBeLessThan(0.2)
	})

	it('reports removing nothing when there is no background to find', () => {
		const data = image(20, 20, RED)
		fillRect(data, 20, { x: 0, y: 0, w: 20, h: 20 }, RED)
		// A single flat colour *is* all background — the honest answer is "everything went".
		const { removed } = applyBackgroundMask(data, 20, 20)
		expect(removed).toBeGreaterThan(0.99)
	})

	it('softens the cut edge rather than leaving it jagged', () => {
		// A ramp from white to red across the middle: the transition band should come out partly
		// transparent, not snap from 0 to 255.
		const data = image(40, 10, WHITE)
		for (let x = 20; x < 30; x++) {
			const t = (x - 20) / 9
			fillRect(data, 40, { x, y: 0, w: 1, h: 10 }, [
				Math.round(255 + (220 - 255) * t),
				Math.round(255 + (40 - 255) * t),
				Math.round(255 + (40 - 255) * t),
			])
		}
		applyBackgroundMask(data, 40, 10)

		const alphas = []
		for (let x = 0; x < 40; x++) alphas.push(alphaAt(data, 40, x, 5))
		expect(alphas.some((a) => a > 0 && a < 255)).toBe(true)
	})

	it('honours an explicit tolerance instead of guessing', () => {
		const near = image(30, 30, WHITE)
		// A subject only slightly off-white: a generous tolerance should swallow it, a tight one keep it.
		fillRect(near, 30, { x: 10, y: 10, w: 10, h: 10 }, [225, 225, 225])

		const tight = near.slice()
		applyBackgroundMask(tight, 30, 30, { tolerance: 0.01 })
		expect(alphaAt(tight, 30, 15, 15)).toBe(255)

		const loose = near.slice()
		applyBackgroundMask(loose, 30, 30, { tolerance: 0.5 })
		expect(alphaAt(loose, 30, 15, 15)).toBe(0)
	})

	it('is a no-op on an empty image rather than throwing', () => {
		expect(applyBackgroundMask(new Uint8ClampedArray(0), 0, 0).removed).toBe(0)
	})
})
