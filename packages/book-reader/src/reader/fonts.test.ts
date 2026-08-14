import { describe, expect, it } from 'vitest'
import { BOOK_FONTS, fontFaceCss, fontStack } from './fonts'

describe('fontFaceCss', () => {
	it('declares a roman and an italic for every bundled face', () => {
		const css = fontFaceCss()
		for (const font of BOOK_FONTS) {
			if (!font.stack) continue
			// The family the stack asks for first is the one that must be declared.
			const family = font.stack.match(/^"([^"]+)"/)?.[1]
			expect(family, `${font.id} should lead with a quoted family`).toBeTruthy()
			expect(css).toContain(`font-family: "${family}";`)
		}
		expect(css.match(/font-style: normal;/g)).toHaveLength(BOOK_FONTS.length - 1)
		expect(css.match(/font-style: italic;/g)).toHaveLength(BOOK_FONTS.length - 1)
	})

	it('covers the whole weight axis, so bold is a real cut and not a smear', () => {
		expect(fontFaceCss()).toContain('font-weight: 200 900;')
	})

	it('every declared face is reachable from the menu, and every menu face is declared', () => {
		const declared = [...fontFaceCss().matchAll(/font-family: "([^"]+)";/g)].map((m) => m[1])
		const offered = BOOK_FONTS.filter((f) => f.stack).map((f) => f.stack.match(/^"([^"]+)"/)?.[1])
		expect(new Set(declared)).toEqual(new Set(offered))
	})
})

describe('BOOK_FONTS', () => {
	it('leads every stack with the bundled face, before any fallback', () => {
		for (const font of BOOK_FONTS) {
			if (!font.stack) continue
			expect(font.stack.startsWith('"')).toBe(true)
		}
	})

	it('explains each choice, since a font name tells you nothing on its own', () => {
		for (const font of BOOK_FONTS) expect(font.note.length).toBeGreaterThan(10)
	})

	it('resolves "Original" to no family at all', () => {
		expect(fontStack('original')).toBe('')
	})
})
