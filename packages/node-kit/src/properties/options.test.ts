import { describe, expect, it } from 'vitest'
import { choiceStyle, optionHue } from './options'

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
		const hues = ['TODO', 'DOING', 'DONE'].map((option) => optionHue(option))
		expect(new Set(hues).size).toBe(3)
	})

	it('survives a label long enough to overflow a naive hash', () => {
		const long = 'x'.repeat(5000)
		expect(Number.isFinite(optionHue(long))).toBe(true)
		expect(optionHue(long)).toBeGreaterThanOrEqual(0)
	})
})

describe('chosen option colours', () => {
	it('uses the hue a definition names, rather than the hash', () => {
		expect(optionHue('Important', { Important: 42 })).toBe(42)
	})

	it('matches the label as written or lowercased, like the hash does', () => {
		expect(optionHue('Important', { important: 42 })).toBe(42)
	})

	it('falls back to the hash for an option nobody has chosen a colour for', () => {
		expect(optionHue('Other', { Important: 42 })).toBe(optionHue('Other'))
	})

	it('brings a hue back into range rather than emitting nonsense', () => {
		expect(optionHue('x', { x: 400 })).toBe(40)
		expect(optionHue('x', { x: -20 })).toBe(340)
	})

	it('reaches the chip through the definition it is drawn from', () => {
		const def = { type: 'select' as const, optionHues: { Key: 55 } }
		expect(choiceStyle(def, 'Key')['--lb-opt-h']).toBe('55')
	})

	it('leaves a status alone — its colour is its stage, not its label', () => {
		const def = { type: 'status' as const, stages: { Shipped: 'done' as const }, optionHues: { Shipped: 55 } }
		expect(choiceStyle(def, 'Shipped')['--lb-opt-h']).not.toBe('55')
	})
})
