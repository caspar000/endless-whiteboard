import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
	animatesPageTurns,
	BOOK_FONTS,
	clampTo,
	DEFAULT_SETTINGS,
	engineFor,
	fontStack,
	loadReaderSettings,
	PAGE_TURNS,
	READER_CONTROLS,
	READER_THEMES,
	themeOf,
	withAlpha,
	saveReaderSettings,
	type ReaderSettings,
} from './settings'
import { highlightProperty } from '../quote/definition'

/** A localStorage that behaves like the real one, since node has none by default. */
function stubStorage(seed: Record<string, string> = {}) {
	const map = new Map(Object.entries(seed))
	Object.defineProperty(globalThis, 'localStorage', {
		configurable: true,
		value: {
			getItem: (key: string) => map.get(key) ?? null,
			setItem: (key: string, value: string) => void map.set(key, value),
			removeItem: (key: string) => void map.delete(key),
		},
	})
	return map
}

const control = (key: string) => READER_CONTROLS.find((c) => c.key === key)!

afterEach(() => {
	Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('clampTo', () => {
	it('snaps to the control’s step', () => {
		expect(clampTo(control('textScale'), 103)).toBe(105)
		expect(clampTo(control('pageWidth'), 611)).toBe(620)
	})

	it('holds the value inside the range', () => {
		expect(clampTo(control('zoom'), 5000)).toBe(200)
		expect(clampTo(control('zoom'), -10)).toBe(50)
	})

	it('does not leave float noise behind, so 1.5 stays 1.5', () => {
		expect(clampTo(control('lineHeight'), 1.5000000001)).toBe(1.5)
		expect(clampTo(control('lineHeight'), 1.73)).toBe(1.7)
	})
})

describe('loadReaderSettings', () => {
	beforeEach(() => stubStorage())

	it('is the defaults when nothing has been saved', () => {
		expect(loadReaderSettings()).toEqual(DEFAULT_SETTINGS)
	})

	it('round-trips what was saved', () => {
		const settings = { ...DEFAULT_SETTINGS, viewMode: 'scroll' as const, textScale: 140 }
		saveReaderSettings(settings)
		expect(loadReaderSettings()).toEqual(settings)
	})

	it('keeps the view mode chosen before the other settings existed', () => {
		stubStorage({ 'lifeboard:readerViewMode': 'spread' })
		expect(loadReaderSettings().viewMode).toBe('spread')
	})

	it('clamps a hand-edited value rather than rendering an unusable page', () => {
		stubStorage({ 'lifeboard:reader': JSON.stringify({ pageWidth: 99999, textScale: -4 }) })
		const loaded = loadReaderSettings()
		expect(loaded.pageWidth).toBe(control('pageWidth').max!)
		expect(loaded.textScale).toBe(control('textScale').min!)
	})

	it('falls back to the defaults for malformed or wrongly typed values', () => {
		stubStorage({ 'lifeboard:reader': 'not json' })
		expect(loadReaderSettings()).toEqual(DEFAULT_SETTINGS)

		stubStorage({ 'lifeboard:reader': JSON.stringify({ textScale: 'big', viewMode: 'sideways' }) })
		expect(loadReaderSettings()).toEqual(DEFAULT_SETTINGS)
	})

	it('opens a book even where there is no storage at all', () => {
		// Private-mode Safari throws on access; the node path has no `localStorage` to begin with.
		Reflect.deleteProperty(globalThis, 'localStorage')
		expect(loadReaderSettings()).toEqual(DEFAULT_SETTINGS)
		expect(() => saveReaderSettings(DEFAULT_SETTINGS)).not.toThrow()
	})
})

describe('engineFor', () => {
	it('gives a PDF the fixed-layout controls', () => {
		expect(engineFor('pdf')).toBe('fixed')
	})

	it('gives every reflowable format the typography controls', () => {
		expect(engineFor('epub')).toBe('reflowable')
		expect(engineFor('mobi')).toBe('reflowable')
		expect(engineFor('fb2')).toBe('reflowable')
	})

	it('gives a comic none — it has neither text to size nor a page to choose', () => {
		expect(engineFor('cbz')).toBeNull()
	})
})

describe('READER_CONTROLS', () => {
	it('gives every setting a control, so none is unreachable', () => {
		// Three settings have controls of their own rather than a row: the view mode has the layout
		// cards, the theme has the theme cards, and the tags have the editor on the Tools page.
		// Everything else must be reachable from one of the settings pages, derived from the
		// settings themselves so that adding one fails here until it is wired up.
		const ownControl = new Set(['viewMode', 'theme', 'tags'])
		const reachable = new Set(READER_CONTROLS.map((c) => c.key))
		const unreachable = Object.keys(DEFAULT_SETTINGS).filter(
			(key) => !ownControl.has(key) && !reachable.has(key as never)
		)
		expect(unreachable).toEqual([])
	})

	it('has defaults that already sit inside their own ranges', () => {
		for (const c of READER_CONTROLS) {
			if (c.kind !== 'slider') continue
			expect(clampTo(c, DEFAULT_SETTINGS[c.key] as number)).toBe(DEFAULT_SETTINGS[c.key])
		}
	})

	it('describes each control well enough to render it', () => {
		for (const c of READER_CONTROLS) {
			if (c.kind === 'slider') {
				expect(typeof c.min, c.key).toBe('number')
				expect(typeof c.max, c.key).toBe('number')
				expect(c.max!).toBeGreaterThan(c.min!)
			}
			// `font` and `quoteTag` are filled in by the panel, from the modules that own those lists.
			const resolvedElsewhere = c.key === 'font' || c.key === 'quoteTag'
			if (c.kind === 'select' && !resolvedElsewhere) expect(c.options?.length).toBeGreaterThan(1)
		}
	})

	it('gives every control a heading to sit under', () => {
		for (const c of READER_CONTROLS) expect(c.section, c.key).toBeTruthy()
	})

	it('sorts every control into a settings page', () => {
		for (const c of READER_CONTROLS) expect(['layout', 'theme', 'tools']).toContain(c.group)
	})
})

describe('READER_THEMES', () => {
	it('recognises the defaults as the Default theme', () => {
		expect(themeOf(DEFAULT_SETTINGS)).toBe('default')
	})

	it('calls a hand-picked colour custom, so no preset claims someone else’s look', () => {
		expect(themeOf({ ...DEFAULT_SETTINGS, pageColor: '#123456' })).toBe('custom')
	})

	it('matches each preset it ships', () => {
		for (const theme of READER_THEMES) {
			expect(themeOf({ ...DEFAULT_SETTINGS, ...theme })).toBe(theme.id)
		}
	})

	it('keeps a saved colour, and ignores one that is not a colour', () => {
		stubStorage({ 'lifeboard:reader': JSON.stringify({ pageColor: '#102030' }) })
		expect(loadReaderSettings().pageColor).toBe('#102030')

		stubStorage({ 'lifeboard:reader': JSON.stringify({ pageColor: 'chartreuse' }) })
		expect(loadReaderSettings().pageColor).toBe(DEFAULT_SETTINGS.pageColor)
	})
})

describe('withAlpha', () => {
	it('turns a hex colour and a strength into something CSS can use', () => {
		expect(withAlpha('#000000', 45)).toBe('rgb(0 0 0 / 45%)')
		expect(withAlpha('#ffffff', 10)).toBe('rgb(255 255 255 / 10%)')
	})

	it('accepts the short form', () => {
		expect(withAlpha('#fff', 50)).toBe('rgb(255 255 255 / 50%)')
	})

	it('falls back to black rather than emitting nonsense', () => {
		expect(withAlpha('not-a-colour', 20)).toBe('rgb(0 0 0 / 20%)')
	})
})

describe('BOOK_FONTS', () => {
	it('offers "Original", which means leaving the publisher’s typography alone', () => {
		expect(fontStack('original')).toBe('')
	})

	it('defaults to a face drawn for reading rather than the browser’s', () => {
		expect(fontStack(DEFAULT_SETTINGS.font)).toContain('Literata')
	})

	it('ends every stack in a generic, so an unknown machine still gets a reasonable face', () => {
		for (const font of BOOK_FONTS) {
			if (!font.stack) continue
			expect(font.stack).toMatch(/(serif|sans-serif)$/)
		}
	})

	it('has unique ids — they are what a saved setting names', () => {
		expect(new Set(BOOK_FONTS.map((f) => f.id)).size).toBe(BOOK_FONTS.length)
	})

	it('falls back to the publisher’s own for a font we no longer ship', () => {
		expect(fontStack('some-font-from-an-older-build')).toBe('')
	})

	it('keeps a saved font, and ignores one that is not on the menu', () => {
		stubStorage({ 'lifeboard:reader': JSON.stringify({ font: 'eb-garamond' }) })
		expect(loadReaderSettings().font).toBe('eb-garamond')

		stubStorage({ 'lifeboard:reader': JSON.stringify({ font: 'comic-sans' }) })
		expect(loadReaderSettings().font).toBe(DEFAULT_SETTINGS.font)
	})

	it('round-trips through a save', () => {
		stubStorage()
		saveReaderSettings({ ...DEFAULT_SETTINGS, font: 'open-sans' })
		expect(loadReaderSettings().font).toBe('open-sans')
	})
})

describe('animatesPageTurns', () => {
	const stubMotion = (reduce: boolean) => {
		Object.defineProperty(globalThis, 'matchMedia', {
			configurable: true,
			value: (query: string) => ({ matches: reduce && query.includes('reduced-motion') }),
		})
	}

	afterEach(() => Reflect.deleteProperty(globalThis, 'matchMedia'))

	it('animates when the setting asks for it', () => {
		stubMotion(false)
		expect(animatesPageTurns({ ...DEFAULT_SETTINGS, pageTurn: 'slide' })).toBe(true)
	})

	it('does not when the setting is off', () => {
		stubMotion(false)
		expect(animatesPageTurns({ ...DEFAULT_SETTINGS, pageTurn: 'none' })).toBe(false)
	})

	it('yields to someone who has asked the OS for less motion', () => {
		stubMotion(true)
		expect(animatesPageTurns({ ...DEFAULT_SETTINGS, pageTurn: 'slide' })).toBe(false)
	})

	it('animates where there is no `matchMedia` to ask', () => {
		Reflect.deleteProperty(globalThis, 'matchMedia')
		expect(animatesPageTurns({ ...DEFAULT_SETTINGS, pageTurn: 'slide' })).toBe(true)
	})
})

describe('PAGE_TURNS', () => {
	it('keeps a saved choice and ignores one it does not offer', () => {
		stubStorage({ 'lifeboard:reader': JSON.stringify({ pageTurn: 'none' }) })
		expect(loadReaderSettings().pageTurn).toBe('none')

		stubStorage({ 'lifeboard:reader': JSON.stringify({ pageTurn: 'dissolve' }) })
		expect(loadReaderSettings().pageTurn).toBe(DEFAULT_SETTINGS.pageTurn)
	})

	it('offers a way to turn the animation off', () => {
		expect(PAGE_TURNS.map((t) => t.id)).toContain('none')
	})
})

describe('toggles', () => {
	it('keeps a saved choice, and ignores a value of the wrong type', () => {
		stubStorage({ 'lifeboard:reader': JSON.stringify({ pageShadow: false, pageSeam: 'yes' }) })
		const loaded = loadReaderSettings()
		expect(loaded.pageShadow).toBe(false)
		expect(loaded.pageSeam).toBe(DEFAULT_SETTINGS.pageSeam)
	})

	it('offers the seam only where there are two pages to seam', () => {
		const seam = READER_CONTROLS.find((c) => c.key === 'pageSeam')
		expect(seam?.engine).toBe('reflowable')
		expect(seam?.viewMode).toBe('spread')
	})
})

describe('PAGE_TURNS — curl', () => {
	it('is offered for every book, since the reader draws it rather than the format', () => {
		expect(PAGE_TURNS.map((t) => t.id)).toContain('curl')
	})
})

describe('every kind of control round-trips', () => {
	// The regression this exists for: `loadReaderSettings` grew branches for sliders, toggles and
	// colours but never one for menus, so a saved `quoteTag` silently came back as the default and
	// the plain quote button quietly stopped tagging anything.
	it('saves and reloads a value of each kind', () => {
		stubStorage()
		const changed: ReaderSettings = {
			...DEFAULT_SETTINGS,
			markOpacity: 65, // slider
			quoteArrow: false, // toggle
			pageColor: '#102030', // colour
			quoteTag: 'Key', // select, options owned elsewhere
			pageTurn: 'slide', // select, options owned here
		}
		saveReaderSettings(changed)
		const loaded = loadReaderSettings()
		expect(loaded.markOpacity).toBe(65)
		expect(loaded.quoteArrow).toBe(false)
		expect(loaded.pageColor).toBe('#102030')
		expect(loaded.quoteTag).toBe('Key')
		expect(loaded.pageTurn).toBe('slide')
	})

	it('still refuses a menu value it does not offer', () => {
		stubStorage({ 'lifeboard:reader': JSON.stringify({ pageTurn: 'dissolve', font: 'comic-sans' }) })
		const loaded = loadReaderSettings()
		expect(loaded.pageTurn).toBe(DEFAULT_SETTINGS.pageTurn)
		expect(loaded.font).toBe(DEFAULT_SETTINGS.font)
	})
})

describe('highlight tags', () => {
	it('ships the four the reader has always had, at the hues the hash used to give them', () => {
		expect(DEFAULT_SETTINGS.tags.map((t) => t.label)).toEqual([
			'Key',
			'Question',
			'Disagree',
			'Follow up',
		])
	})

	it('round-trips a renamed and recoloured list', () => {
		stubStorage()
		saveReaderSettings({
			...DEFAULT_SETTINGS,
			tags: [{ label: 'Important', hue: 55 }, { label: 'Later', hue: 200 }],
		})
		expect(loadReaderSettings().tags).toEqual([
			{ label: 'Important', hue: 55 },
			{ label: 'Later', hue: 200 },
		])
	})

	it('drops entries that are not tags, rather than rendering a blank chip', () => {
		stubStorage({
			'lifeboard:reader': JSON.stringify({
				tags: [{ label: 'Good', hue: 10 }, { label: '  ' }, { hue: 3 }, 'nope', null],
			}),
		})
		expect(loadReaderSettings().tags).toEqual([{ label: 'Good', hue: 10 }])
	})

	it('brings a hue back into range', () => {
		stubStorage({ 'lifeboard:reader': JSON.stringify({ tags: [{ label: 'A', hue: 400 }] }) })
		expect(loadReaderSettings().tags[0]?.hue).toBe(40)
	})

	it('keeps the defaults when the saved list has nothing usable in it', () => {
		// An empty list would leave the quote bar with no buttons and no way to get them back.
		stubStorage({ 'lifeboard:reader': JSON.stringify({ tags: [] }) })
		expect(loadReaderSettings().tags).toEqual(DEFAULT_SETTINGS.tags)
	})
})

describe('highlightProperty', () => {
	it('carries the tags as options and their colours alongside', () => {
		const def = highlightProperty([{ label: 'Important', hue: 55 }])
		expect(def.options).toEqual(['Important'])
		expect(def.optionHues).toEqual({ Important: 55 })
	})
})
