import { describe, expect, it } from 'vitest'
import { placedSize } from './image'

/**
 * Sizing a fetched image.
 *
 * Aspect ratio is the only thing here that cannot be corrected afterwards by dragging a handle — a
 * stretched picture has to be deleted and re-fetched — so it is what these pin.
 */

const ratio = ({ w, h }: { w: number; h: number }) => w / h

describe('placing a fetched image', () => {
	it('keeps a large image inside the cap rather than swamping the board', () => {
		const placed = placedSize({ width: 4000, height: 3000 })
		expect(placed.w).toBe(720)
		expect(ratio(placed)).toBeCloseTo(4 / 3, 2)
	})

	it('leaves a small image at its own size instead of blowing it up', () => {
		expect(placedSize({ width: 200, height: 150 })).toEqual({ w: 200, h: 150 })
	})

	it('honours an explicit width, including one above the cap', () => {
		// The cap protects against an unconsidered default, not against an explicit request — a user
		// who asked for a 1200-wide image meant it.
		const placed = placedSize({ width: 4000, height: 2000 }, 1200)
		expect(placed).toEqual({ w: 1200, h: 600 })
	})

	it('ignores a nonsensical width rather than producing a zero-sized shape', () => {
		expect(placedSize({ width: 800, height: 400 }, 0)).toEqual({ w: 720, h: 360 })
		expect(placedSize({ width: 800, height: 400 }, -50)).toEqual({ w: 720, h: 360 })
	})

	it('holds the ratio on tall images too', () => {
		const placed = placedSize({ width: 1000, height: 2500 })
		expect(ratio(placed)).toBeCloseTo(0.4, 2)
	})
})
