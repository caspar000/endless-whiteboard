import { describe, expect, it } from 'vitest'
import { decodeRects, encodeRects } from './rects'

describe('encodeRects / decodeRects', () => {
	it('round-trips the rectangles a multi-line passage produces', () => {
		const rects = [
			{ x: 0.1, y: 0.2, w: 0.5, h: 0.02 },
			{ x: 0.1, y: 0.24, w: 0.3, h: 0.02 },
		]
		expect(decodeRects(encodeRects(rects))).toEqual(rects)
	})

	it('rounds to a sane precision rather than storing float noise', () => {
		expect(encodeRects([{ x: 0.123456, y: 0.5, w: 0.25, h: 0.019999 }])).toBe('0.123,0.5,0.25,0.02')
	})

	it('drops rectangles with no area — line boundaries produce them', () => {
		expect(encodeRects([{ x: 0.1, y: 0.2, w: 0, h: 0.02 }])).toBe('')
		expect(encodeRects([{ x: 0.1, y: 0.2, w: 0.5, h: 0 }])).toBe('')
	})

	it('reads nothing from an empty or malformed value rather than throwing', () => {
		// A quote taken before highlights existed has '', and meta is never validated by tldraw.
		expect(decodeRects('')).toEqual([])
		expect(decodeRects('nonsense')).toEqual([])
		expect(decodeRects('1,2,3')).toEqual([])
		expect(decodeRects('a,b,c,d')).toEqual([])
		expect(decodeRects('0.1,0.2,0,0.4')).toEqual([])
	})

	it('keeps the good rectangles in a partly broken value', () => {
		expect(decodeRects('0.1,0.2,0.3,0.4;broken;0.5,0.6,0.1,0.1')).toEqual([
			{ x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
			{ x: 0.5, y: 0.6, w: 0.1, h: 0.1 },
		])
	})
})
