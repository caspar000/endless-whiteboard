import { describe, expect, it } from 'vitest'
import { nameOf, plainOf, richTextFrom, titleOf } from './text'

describe('a note’s text', () => {
	it('reads a first line starting with # as the title, and blank lines as breaks', () => {
		const rich = richTextFrom('# Society\n\nWhat a society is.\n\nSee [[1a]].')
		expect(titleOf(rich)).toBe('Society')
		expect(nameOf(rich)).toBe('Society')
		expect(plainOf(rich)).toBe('# Society\nWhat a society is.\nSee [[1a]].')
	})

	it('has no title when the first line isn’t one, and is never an empty document', () => {
		const rich = richTextFrom('Just a thought.\n# not a title here')
		expect(titleOf(rich)).toBe(null)
		expect(plainOf(rich)).toBe('Just a thought.\n# not a title here')
		expect(plainOf(richTextFrom(''))).toBe('')
	})
})
