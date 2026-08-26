import { describe, expect, it } from 'vitest'
import { READER_HOTKEYS, readerHotkey, viewModeKey } from './keys'
import { VIEW_MODES } from './types'

/** A keystroke, with nothing held down unless the test says so. */
function press(key: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {}) {
	return readerHotkey({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods })
}

describe('readerHotkey', () => {
	it('reads the bar: contents, the two clips, the settings', () => {
		expect(press('t')).toEqual({ kind: 'contents' })
		expect(press('c')).toEqual({ kind: 'clipRegion' })
		expect(press('c', { shiftKey: true })).toEqual({ kind: 'clipPage' })
		expect(press(',')).toEqual({ kind: 'settings' })
	})

	it('takes the layouts in the order their buttons sit in', () => {
		VIEW_MODES.forEach((mode, index) => {
			expect(press(String(index + 1))).toEqual({ kind: 'view', mode })
			expect(viewModeKey(mode)).toBe(String(index + 1))
		})
		// One digit per layout and no more — a fourth would silently do nothing visible.
		expect(press(String(VIEW_MODES.length + 1))).toBeNull()
	})

	it('is case-insensitive, since caps lock is not a modifier anyone means', () => {
		expect(press('T')).toEqual({ kind: 'contents' })
	})

	/*
	 * The one that matters. ⌘C in a PDF is a copy and ⌘K is the palette; a reader that clipped a page
	 * whenever you tried to copy a sentence would be unusable, and unbrowsable besides.
	 */
	it('leaves every modified chord alone', () => {
		for (const mod of ['metaKey', 'ctrlKey', 'altKey'] as const) {
			expect(press('c', { [mod]: true })).toBeNull()
			expect(press('t', { [mod]: true })).toBeNull()
			expect(press('1', { [mod]: true })).toBeNull()
			expect(press(',', { [mod]: true })).toBeNull()
		}
	})

	it('reads shift only where it means "the bigger version of this"', () => {
		expect(press('t', { shiftKey: true })).toBeNull()
		expect(press('1', { shiftKey: true })).toBeNull()
		// ⇧, is < on most layouts, and ⇧1 is the app's own Zoom to fit.
		expect(press(',', { shiftKey: true })).toBeNull()
	})

	it('claims nothing it was not given', () => {
		expect(press('z')).toBeNull()
		expect(press('ArrowRight')).toBeNull()
		expect(press(' ')).toBeNull()
		expect(press('Escape')).toBeNull()
	})
})

describe('READER_HOTKEYS', () => {
	it('is written the way the key is pressed, so a tooltip can be trusted', () => {
		expect(press(READER_HOTKEYS.contents)).toEqual({ kind: 'contents' })
		expect(press(READER_HOTKEYS.clipRegion)).toEqual({ kind: 'clipRegion' })
		expect(press(READER_HOTKEYS.settings)).toEqual({ kind: 'settings' })
		// The one with a modifier in it spells the modifier, and is the chord it describes.
		expect(READER_HOTKEYS.clipPage).toBe(`⇧${READER_HOTKEYS.clipRegion}`)
	})
})
