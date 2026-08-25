import { describe, expect, it } from 'vitest'
import {
	detectBookFormat,
	formatContributors,
	formatLanguageMap,
	isRarArchive,
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
		expect(detectBookFormat('watchmen.cbr')).toBe('cbr')
	})

	it('is case-insensitive and rejects everything else', () => {
		expect(detectBookFormat('DUNE.EPUB')).toBe('epub')
		expect(detectBookFormat('notes.txt')).toBeNull()
		expect(detectBookFormat('archive.zip')).toBeNull()
		expect(detectBookFormat('pdf')).toBeNull()
	})
})

describe('isRarArchive', () => {
	const bytes = (...head: number[]) => new Blob([Uint8Array.from([...head, 0xde, 0xad, 0xbe, 0xef])])
	const RAR = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]

	// RAR 4 goes on with \x00 and RAR 5 with \x01\x00; everything up to there is shared, and unrar
	// reads both — so the shared part is the whole test.
	it('recognises the signature RAR 4 and RAR 5 share', async () => {
		await expect(isRarArchive(bytes(...RAR, 0x00))).resolves.toBe(true)
		await expect(isRarArchive(bytes(...RAR, 0x01, 0x00))).resolves.toBe(true)
	})

	it('rejects the zip a mislabelled .cbr usually turns out to be', async () => {
		await expect(isRarArchive(bytes(0x50, 0x4b, 0x03, 0x04))).resolves.toBe(false)
	})

	it('rejects a file too short to carry the signature', async () => {
		await expect(isRarArchive(new Blob([Uint8Array.from([0x52, 0x61])]))).resolves.toBe(false)
		await expect(isRarArchive(new Blob([]))).resolves.toBe(false)
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
		expect(titleFromFileName('Watchmen_01.cbr')).toBe('Watchmen 01')
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
