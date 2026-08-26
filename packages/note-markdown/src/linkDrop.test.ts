import { describe, expect, it } from 'vitest'
import { linkDropImport } from './linkDrop'

const claims = (text: string) => linkDropImport.matches(text)

describe('linkDropImport.matches', () => {
	it('claims a bare link', () => {
		expect(claims('https://en.wikipedia.org/wiki/Whiteboard')).toBe(true)
		expect(claims('  http://example.com/a?b=c#d  ')).toBe(true)
	})

	it('leaves prose alone even when there is a link in it', () => {
		// Text with a link in the middle is prose, and prose is tldraw's text shape.
		expect(claims('see https://example.com for details')).toBe(false)
	})

	it('requires a scheme, so a filename is not read as a hostname', () => {
		// `normalizeUrl` assumes https:// for a bare word — right when someone is typing a link into a
		// field, wrong when deciding whether what they pasted was one.
		expect(claims('notes.txt')).toBe(false)
		expect(claims('example.com')).toBe(false)
	})

	it('refuses a scheme with nothing behind it, and other protocols', () => {
		expect(claims('https://')).toBe(false)
		expect(claims('javascript:alert(1)')).toBe(false)
		expect(claims('mailto:someone@example.com')).toBe(false)
		expect(claims('')).toBe(false)
	})
})
