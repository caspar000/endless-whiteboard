import { describe, expect, it } from 'vitest'
import { optionHue } from './options'

describe('option colours', () => {
	it('gives the same option the same hue every time', () => {
		// The whole reason the hue is hashed rather than stored: "DOING" has to look the same on every
		// board and in every table without anything being written down.
		expect(optionHue('DOING')).toBe(optionHue('DOING'))
	})

	it('ignores case and surrounding space, so one option is one colour', () => {
		expect(optionHue('DONE')).toBe(optionHue('done'))
		expect(optionHue('done')).toBe(optionHue(' done '))
	})

	it('leaves inner spacing alone — two spellings are two options', () => {
		expect(optionHue('To Do')).not.toBe(optionHue('ToDo'))
	})

	it('separates the options someone is most likely to have side by side', () => {
		const hues = ['TODO', 'DOING', 'DONE'].map(optionHue)
		expect(new Set(hues).size).toBe(3)
	})

	it('survives a label long enough to overflow a naive hash', () => {
		const long = 'x'.repeat(5000)
		expect(Number.isFinite(optionHue(long))).toBe(true)
		expect(optionHue(long)).toBeGreaterThanOrEqual(0)
	})
})
