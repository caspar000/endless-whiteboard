import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	getLayoutLibrary,
	removeLayoutFromLibrary,
	replaceLayoutLibrary,
	saveLayoutToLibrary,
	setLayoutLibraryPersistence,
} from './layoutLibrary'

const layout = { rows: [{ left: [{ kind: 'property' as const, property: 'price' }] }] }

describe('the layout library', () => {
	beforeEach(() => {
		setLayoutLibraryPersistence(null)
		replaceLayoutLibrary([])
	})

	it('saves, replaces by name ignoring case, removes, and persists each change', () => {
		const persisted = vi.fn()
		setLayoutLibraryPersistence(persisted)
		saveLayoutToLibrary('Event card', layout)
		saveLayoutToLibrary('event CARD', { rows: [] })
		expect(getLayoutLibrary()).toEqual([{ name: 'event CARD', layout: { rows: [] } }])
		removeLayoutFromLibrary('event CARD')
		expect(getLayoutLibrary()).toEqual([])
		expect(persisted).toHaveBeenCalledTimes(3)
	})

	it('drops malformed entries from a stored list, and does not persist what it was given', () => {
		const persisted = vi.fn()
		setLayoutLibraryPersistence(persisted)
		replaceLayoutLibrary([{ name: 'Good', layout }, { name: '', layout }, { name: 'Bad', layout: 3 }, 'junk'])
		expect(getLayoutLibrary().map((saved) => saved.name)).toEqual(['Good'])
		expect(persisted).not.toHaveBeenCalled()
	})
})
