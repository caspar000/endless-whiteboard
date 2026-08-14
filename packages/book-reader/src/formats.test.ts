import { describe, expect, it } from 'vitest'
import {
	detectBookFormat,
	formatContributors,
	formatLanguageMap,
	titleFromFileName,
} from './formats'

describe('detectBookFormat', () => {
	it('maps suffixes to render formats', () => {
		expect(detectBookFormat('dune.pdf')).toBe('pdf')
		expect(detectBookFormat('dune.epub')).toBe('epub')
		expect(detectBookFormat('dune.mobi')).toBe('mobi')
		expect(detectBookFormat('dune.azw3')).toBe('mobi')
		expect(detectBookFormat('dune.azw')).toBe('mobi')
		expect(detectBookFormat('dune.fb2')).toBe('fb2')
		expect(detectBookFormat('dune.fb2.zip')).toBe('fb2')
		expect(detectBookFormat('dune.fbz')).toBe('fb2')
		expect(detectBookFormat('watchmen.cbz')).toBe('cbz')
	})

	it('is case-insensitive and rejects everything else', () => {
		expect(detectBookFormat('DUNE.EPUB')).toBe('epub')
		expect(detectBookFormat('notes.txt')).toBeNull()
		expect(detectBookFormat('archive.zip')).toBeNull()
		expect(detectBookFormat('pdf')).toBeNull()
	})
})

describe('titleFromFileName', () => {
	it('strips the suffix, including compound ones', () => {
		expect(titleFromFileName('Dune.epub')).toBe('Dune')
		expect(titleFromFileName('Dune.fb2.zip')).toBe('Dune')
	})

	it('reads underscores as spaces', () => {
		expect(titleFromFileName('The_Left_Hand_of_Darkness.mobi')).toBe('The Left Hand of Darkness')
	})

	it('keeps dots that are not a known suffix', () => {
		expect(titleFromFileName('vol.2.cbz')).toBe('vol.2')
	})
})

describe('formatLanguageMap', () => {
	it('passes strings through and picks the first language entry', () => {
		expect(formatLanguageMap('Dune')).toBe('Dune')
		expect(formatLanguageMap({ en: 'Dune', fr: 'Dune (fr)' })).toBe('Dune')
	})

	it('returns empty for anything malformed', () => {
		expect(formatLanguageMap(undefined)).toBe('')
		expect(formatLanguageMap(42)).toBe('')
		expect(formatLanguageMap(['Dune'])).toBe('')
	})
})

describe('formatContributors', () => {
	it('handles strings, name objects, and arrays of either', () => {
		expect(formatContributors('Frank Herbert')).toBe('Frank Herbert')
		expect(formatContributors({ name: 'Frank Herbert' })).toBe('Frank Herbert')
		expect(formatContributors([{ name: 'Kernighan' }, 'Ritchie'])).toBe('Kernighan, Ritchie')
		expect(formatContributors([{ name: { en: 'Tolstoy' } }])).toBe('Tolstoy')
	})

	it('drops empty entries rather than printing separators for them', () => {
		expect(formatContributors(['', { name: 'Le Guin' }])).toBe('Le Guin')
		expect(formatContributors(undefined)).toBe('')
	})
})
