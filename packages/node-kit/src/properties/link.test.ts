import { describe, expect, it } from 'vitest'
import { encodeLinkValue, linkDisplayText, linkHref, parseLinkValue } from './link'
import { formatPropertyValue, groupKeysForValue } from './format'
import type { PropertyDef } from './types'

const def: PropertyDef = { id: 'docs', name: 'Docs', type: 'link' }

describe('link value encoding', () => {
	it('round-trips a title and a URL through one scalar value', () => {
		const encoded = encodeLinkValue({ title: 'Docs', url: 'https://lifeboard.app' })
		expect(encoded).toBe('[Docs](https://lifeboard.app)')
		expect(parseLinkValue(encoded)).toEqual({ title: 'Docs', url: 'https://lifeboard.app' })
	})

	it('stores a bare URL when there is no title, so a backup stays readable', () => {
		expect(encodeLinkValue({ title: '', url: 'https://lifeboard.app' })).toBe(
			'https://lifeboard.app'
		)
		expect(parseLinkValue('https://lifeboard.app')).toEqual({
			title: '',
			url: 'https://lifeboard.app',
		})
	})

	it('is empty when neither half has anything in it', () => {
		expect(encodeLinkValue({ title: '', url: '' })).toBeNull()
		expect(encodeLinkValue({ title: '  ', url: '  ' })).toBeNull()
		expect(parseLinkValue(null)).toEqual({ title: '', url: '' })
	})

	it('keeps a title that contains a bracket', () => {
		const encoded = encodeLinkValue({ title: 'Docs [draft]', url: 'https://lifeboard.app' })
		expect(parseLinkValue(encoded)).toEqual({
			title: 'Docs [draft]',
			url: 'https://lifeboard.app',
		})
	})

	/** A `url` property changed to `link` keeps its value — the bare string is already valid. */
	it('reads a plain string left behind by the older url type', () => {
		expect(parseLinkValue('lifeboard.app')).toEqual({ title: '', url: 'lifeboard.app' })
	})
})

describe('link display', () => {
	it('shows the title, and falls back to the domain rather than to nothing', () => {
		expect(linkDisplayText('[Docs](https://lifeboard.app)')).toBe('Docs')
		expect(linkDisplayText('https://www.lifeboard.app/pricing')).toBe('lifeboard.app')
		expect(formatPropertyValue(def, '[Docs](https://lifeboard.app)')).toBe('Docs')
		expect(formatPropertyValue(def, null)).toBe('—')
	})

	it('only produces an href for a scheme that cannot execute', () => {
		expect(linkHref('[Docs](lifeboard.app)')).toBe('https://lifeboard.app/')
		expect(linkHref('[Totally safe](javascript:alert(1))')).toBeNull()
		expect(linkHref('[Nothing](  )')).toBeNull()
	})

	it('groups by the address, so two names for one page share a bucket', () => {
		expect(groupKeysForValue(def, '[Docs](https://lifeboard.app)')).toEqual([
			'https://lifeboard.app',
		])
		expect(groupKeysForValue(def, '[Handbook](https://lifeboard.app)')).toEqual([
			'https://lifeboard.app',
		])
		expect(groupKeysForValue(def, null)).toEqual([])
	})
})
