import { describe, expect, it, vi } from 'vitest'
import { createPageCache } from './pageCache'

/** A canvas of a known pixel cost, without needing a real one. */
const fake = (w: number, h: number) =>
	({ canvas: { width: w, height: h } as HTMLCanvasElement, cssHeight: h, aspect: h / w })

describe('createPageCache', () => {
	it('returns what it was given, keyed by page, width and scale', () => {
		const cache = createPageCache()
		cache.put(3, 600, 2, fake(1200, 1800))
		expect(cache.get(3, 600, 2)?.canvas.width).toBe(1200)
		// A raster drawn for another zoom is the wrong pixels, and must miss.
		expect(cache.get(3, 800, 2)).toBeUndefined()
		expect(cache.get(3, 600, 1)).toBeUndefined()
		expect(cache.get(4, 600, 2)).toBeUndefined()
	})

	it('evicts by memory, not by count — a page is not a fixed size', () => {
		const cache = createPageCache()
		// Eight megapixels each: four fit inside the budget, the fifth pushes one out.
		for (let page = 1; page <= 5; page++) cache.put(page, 600, 2, fake(2000, 4000))
		expect(cache.size()).toBeLessThanOrEqual(24_000_000)
		// The one just added is always kept.
		expect(cache.get(5, 600, 2)).toBeDefined()
		// The oldest went first.
		expect(cache.get(1, 600, 2)).toBeUndefined()
	})

	it('keeps a page that is still being read, however old it is', () => {
		const cache = createPageCache()
		for (let page = 1; page <= 3; page++) cache.put(page, 600, 2, fake(2000, 4000))
		cache.get(1, 600, 2) // touched: now the most recent
		cache.put(4, 600, 2, fake(2000, 4000))
		cache.put(5, 600, 2, fake(2000, 4000))
		expect(cache.get(1, 600, 2)).toBeDefined()
		expect(cache.get(2, 600, 2)).toBeUndefined()
	})

	it('replaces rather than double-counts when the same page is put twice', () => {
		const cache = createPageCache()
		cache.put(1, 600, 2, fake(1000, 1000))
		const once = cache.size()
		cache.put(1, 600, 2, fake(1000, 1000))
		expect(cache.size()).toBe(once)
	})

	it('lets go of everything when the book closes', () => {
		const cache = createPageCache()
		cache.put(1, 600, 2, fake(1000, 1000))
		cache.clear()
		expect(cache.size()).toBe(0)
		expect(cache.get(1, 600, 2)).toBeUndefined()
	})
})
