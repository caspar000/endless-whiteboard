import { describe, expect, it } from 'vitest'
import { linkHost, normalizeUrl } from './url'

describe('normalizeUrl', () => {
	it('assumes https for a bare host, which is what people type', () => {
		expect(normalizeUrl('lifeboard.app')).toBe('https://lifeboard.app/')
		expect(normalizeUrl('  lifeboard.app/pricing  ')).toBe('https://lifeboard.app/pricing')
	})

	it('keeps a URL that already declares an allowed scheme', () => {
		expect(normalizeUrl('http://example.com/a?b=1')).toBe('http://example.com/a?b=1')
		expect(normalizeUrl('https://example.com/#frag')).toBe('https://example.com/#frag')
		expect(normalizeUrl('mailto:someone@example.com')).toBe('mailto:someone@example.com')
	})

	/**
	 * The reason this module exists. These all parse as perfectly valid URLs, and putting any of them
	 * in an `href` would run script in the app's own origin the moment someone clicked the link.
	 */
	it('refuses schemes that execute', () => {
		expect(normalizeUrl('javascript:alert(1)')).toBeNull()
		expect(normalizeUrl('JavaScript:alert(1)')).toBeNull()
		expect(normalizeUrl('  javascript:alert(1)')).toBeNull()
		expect(normalizeUrl('data:text/html,<script>alert(1)</script>')).toBeNull()
		expect(normalizeUrl('vbscript:msgbox(1)')).toBeNull()
		expect(normalizeUrl('file:///etc/passwd')).toBeNull()
	})

	it('treats "no URL yet" as an answer rather than an error', () => {
		expect(normalizeUrl('')).toBeNull()
		expect(normalizeUrl('   ')).toBeNull()
	})

	it('rejects a scheme with nothing behind it', () => {
		expect(normalizeUrl('https://')).toBeNull()
		expect(normalizeUrl('mailto:')).toBeNull()
	})
})

describe('linkHost', () => {
	it('shows the domain, without the www noise', () => {
		expect(linkHost('https://www.example.com/deep/path')).toBe('example.com')
		expect(linkHost('https://example.com')).toBe('example.com')
		expect(linkHost('http://localhost:5173/x')).toBe('localhost:5173')
	})

	it('shows the address for a mailto', () => {
		expect(linkHost('mailto:someone@example.com')).toBe('someone@example.com')
	})

	it('is empty for something unparseable, so the card just shows nothing', () => {
		expect(linkHost('not a url')).toBe('')
	})
})
