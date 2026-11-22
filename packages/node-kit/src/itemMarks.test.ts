import { afterEach, describe, expect, it, vi } from 'vitest'
import { aspectRatio, clearItemMarks, getItemStamps, itemRanked, matchesSearch, registerItemReaction, registerItemStamps, sameText } from './itemMarks'
import { setExtensionEnabled } from './registry'

const entry = { id: 'a1', title: 'Solaris', creator: 'Andrei Tarkovsky', year: '1972', cover: '', url: '' }

afterEach(() => {
	clearItemMarks()
	setExtensionEnabled('test.stamps', true)
})

describe('an item ranked (DARK-13)', () => {
	it('is told to every reaction whose extension is on', () => {
		const heard = vi.fn()
		const off = vi.fn()
		registerItemReaction({ id: 'a', extensionId: 'test.stamps', ranked: heard })
		registerItemReaction({ id: 'b', extensionId: 'test.off', ranked: off })
		setExtensionEnabled('test.off', false)
		itemRanked({ entry, from: 'feeds:all', rankingId: 'r1' })
		expect(heard).toHaveBeenCalledWith({ entry, from: 'feeds:all', rankingId: 'r1' })
		expect(off).not.toHaveBeenCalled()
		setExtensionEnabled('test.off', true)
	})

	it('reaches the rest when one reaction throws', () => {
		const heard = vi.fn()
		const error = vi.spyOn(console, 'error').mockImplementation(() => {})
		registerItemReaction({ id: 'a', ranked: () => { throw new Error('no') } })
		registerItemReaction({ id: 'b', ranked: heard })
		itemRanked({ entry, from: '', rankingId: 'r1' })
		expect(heard).toHaveBeenCalled()
		error.mockRestore()
	})
})

describe('who stamps', () => {
	it('is no one while its extension is off', () => {
		registerItemStamps({ extensionId: 'test.stamps', sourceId: 'stamped', kinds: [], stampOf: () => null })
		expect(getItemStamps()?.sourceId).toBe('stamped')
		setExtensionEnabled('test.stamps', false)
		expect(getItemStamps()).toBeNull()
	})
})

describe('searching', () => {
	it('finds every word typed, in the title or the creator, accents and case aside', () => {
		expect(matchesSearch(entry, 'sol')).toBe(true)
		expect(matchesSearch(entry, 'tarkovsky solaris')).toBe(true)
		expect(matchesSearch({ title: 'Mélodie', creator: '' }, 'melodie')).toBe(true)
		expect(matchesSearch(entry, 'stalker')).toBe(false)
		expect(matchesSearch(entry, '  ')).toBe(true)
	})

	it('compares titles across sources, punctuation aside', () => {
		expect(sameText('Kid A', 'kid a ')).toBe(true)
		expect(sameText('Rameau - Hippolyte', 'Rameau: Hippolyte')).toBe(true)
		expect(sameText('Kid A', 'Kid B')).toBe(false)
	})
})

describe('a cover shape', () => {
	it('is a ratio for each named shape, and nothing for Auto or an unknown one', () => {
		expect(aspectRatio('16:9')).toBeCloseTo(16 / 9)
		expect(aspectRatio('2:3')).toBeCloseTo(2 / 3)
		expect(aspectRatio('')).toBeNull()
		expect(aspectRatio('5:1')).toBeNull()
	})
})

