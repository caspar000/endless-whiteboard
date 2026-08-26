import { beforeEach, describe, expect, it } from 'vitest'
import { DIE_KINDS } from './kinds'
import {
	DARK_INK,
	DEFAULT_DICE_COLOUR,
	DEFAULT_DICE_PREFS,
	DICE_PALETTE,
	DICE_SWATCHES,
	LIGHT_INK,
	bodyColourFor,
	edgeColourFor,
	getDicePrefs,
	inkOn,
	setDicePrefs,
	setKindColour,
	subscribeToDicePrefs,
} from './prefs'

beforeEach(() => setDicePrefs(DEFAULT_DICE_PREFS))

describe('inkOn', () => {
	it('puts dark numerals on a light die and light ones on a dark die', () => {
		expect(inkOn(DEFAULT_DICE_COLOUR)).toBe(DARK_INK)
		expect(inkOn('#ffffff')).toBe(DARK_INK)
		expect(inkOn('#1a1a20')).toBe(LIGHT_INK)
		expect(inkOn('#000000')).toBe(LIGHT_INK)
	})

	it('judges by luminance, not by lightness of hue', () => {
		// Yellow is far brighter than blue at the same nominal intensity, and a numeral has to be readable
		// on both — which a naive average of the channels gets wrong.
		expect(inkOn('#ffe000')).toBe(DARK_INK)
		expect(inkOn('#1030c0')).toBe(LIGHT_INK)
	})

	it('keeps every colour in the set readable', () => {
		// The point of the rule: nothing anyone can pick from the palette ends up unreadable.
		for (const kind of DIE_KINDS) {
			expect([DARK_INK, LIGHT_INK], kind).toContain(inkOn(DICE_PALETTE[kind]))
		}
	})
})

describe('dice preferences', () => {
	it('defaults to one bone colour with edges following the numerals', () => {
		expect(getDicePrefs()).toEqual({
			colour: DEFAULT_DICE_COLOUR,
			colourful: false,
			kindColours: {},
			edges: 'follow',
			// A roll is a moment by default; keeping it is the opt-in.
			keepResults: false,
		})
	})

	it('paints the whole set one colour, or a colour per kind', () => {
		setDicePrefs({ colour: '#334455' })
		for (const kind of DIE_KINDS) expect(bodyColourFor(kind), kind).toBe('#334455')

		setDicePrefs({ colourful: true })
		expect(bodyColourFor('d20')).toBe(DICE_PALETTE.d20)
		expect(bodyColourFor('d6')).toBe(DICE_PALETTE.d6)
		expect(bodyColourFor('d100')).toBe(DICE_PALETTE.d100)
	})

	it('follows, overrides or removes the edge highlight', () => {
		expect(edgeColourFor('d20')).toBe(inkOn(DEFAULT_DICE_COLOUR))

		setDicePrefs({ edges: '#ff0000' })
		expect(edgeColourFor('d20')).toBe('#ff0000')

		setDicePrefs({ edges: 'off' })
		expect(edgeColourFor('d20')).toBeNull()
	})

	it('follows each die separately in colourful mode', () => {
		// The edge follows the *numerals*, and the numerals follow the body — so a dark die in a colourful
		// set gets a light edge while its neighbour gets a dark one.
		setDicePrefs({ colourful: true, edges: 'follow' })
		for (const kind of DIE_KINDS) {
			expect(edgeColourFor(kind), kind).toBe(inkOn(DICE_PALETTE[kind]))
		}
	})

	it('notifies subscribers and hands back a stable snapshot', () => {
		const before = getDicePrefs()
		expect(getDicePrefs()).toBe(before)
		let calls = 0
		const stop = subscribeToDicePrefs(() => calls++)
		setDicePrefs({ colour: '#123456' })
		expect(calls).toBe(1)
		expect(getDicePrefs()).not.toBe(before)
		stop()
		setDicePrefs({ colour: '#654321' })
		expect(calls).toBe(1)
	})
})

describe('per-die colours', () => {
	it('overrides one die and leaves the rest on the default palette', () => {
		setDicePrefs({ colourful: true })
		setKindColour('d20', '#123456')
		expect(bodyColourFor('d20')).toBe('#123456')
		expect(bodyColourFor('d6')).toBe(DICE_PALETTE.d6)
	})

	it('clears back to the default rather than freezing it', () => {
		// Stored sparsely on purpose: a kind with no entry follows `DICE_PALETTE`, so the shipped colours
		// can change without being pinned to whatever they were the first time Settings was opened.
		setDicePrefs({ colourful: true })
		setKindColour('d12', '#abcdef')
		expect(getDicePrefs().kindColours.d12).toBe('#abcdef')
		setKindColour('d12', null)
		expect(getDicePrefs().kindColours.d12).toBeUndefined()
		expect(bodyColourFor('d12')).toBe(DICE_PALETTE.d12)
	})

	it('is ignored while the set shares one colour', () => {
		setDicePrefs({ colourful: false, colour: '#334455' })
		setKindColour('d20', '#123456')
		expect(bodyColourFor('d20')).toBe('#334455')
	})

	it('gives the percentile die a colour of its own', () => {
		// It is a second d10 physically, but somebody rolling both at once has every reason to tell them
		// apart — so it defaults to a different colour rather than sharing one.
		expect(DICE_PALETTE.d100).not.toBe(DICE_PALETTE.d10)
	})

	it('keeps every swatch readable, whichever die takes it', () => {
		for (const swatch of DICE_SWATCHES) {
			expect([DARK_INK, LIGHT_INK], swatch).toContain(inkOn(swatch))
		}
	})
})
