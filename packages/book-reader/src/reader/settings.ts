import type { HighlightTag } from '../quote/definition'
import { BOOK_FONTS } from './fonts'
import { VIEW_MODES, type ViewMode } from './types'

export { BOOK_FONTS, fontStack, type BookFont } from './fonts'

/**
 * How tall a page is relative to its width — about a 5.5 × 8.5 inch trade paperback.
 *
 * Only the starting point now that the height is its own setting, but still the right starting
 * point: a reflowable book has no page size of its own, and "as big as the window" is the wrong
 * answer, because on a wide screen it produces lines of eighty words that the eye cannot track
 * back. Paper proportions are what every reader — Books, Kindle, Kobo — settles on.
 */
export const BOOK_PAGE_RATIO = 1.55

/** How wide a PDF page is drawn in scrolling mode at 100%, before zoom. */
export const SCROLL_BASE_WIDTH = 900

/**
 * How a page turn is drawn. Deliberately a list rather than a boolean: turning a page is the one
 * animation a reader has, and there is more than one honest way to draw it.
 */
export const PAGE_TURNS: readonly { id: string; label: string }[] = [
	{ id: 'none', label: 'None' },
	{ id: 'slide', label: 'Slide' },
	{ id: 'peel', label: 'Peel' },
	{ id: 'curl', label: 'Curl' },
]

/**
 * How the reader looks and behaves, for every book.
 *
 * App-wide rather than per book, and for the same reason the view mode always was: how you like to
 * read is a fact about you, not about the volume in your hand. Opening a second book with the text
 * size you set on the first is the behaviour people expect.
 */
export interface ReaderSettings {
	/** The layout preset — one page, two, or a continuous scroll. */
	viewMode: ViewMode
	/** Which of `READER_THEMES` is selected, or 'custom' once anything is changed by hand. */
	theme: string

	// ---- layout ----------------------------------------------------------
	/** One of `PAGE_TURNS`. Ignored while scrolling, which has no page turns to draw. */
	pageTurn: string
	/** How long a page takes to turn, in milliseconds. */
	turnMs: number
	/** How far the fold leans off vertical, in degrees — the diagonal of a real page turn. */
	curlAngle: number
	/** How tight the curl rolls, as a percentage of the page width. */
	curlRadius: number
	/** In a spread, whether the first page stands alone the way a real cover does. */
	coverAlone: boolean
	/** The space between pages while scrolling, in pixels. */
	scrollGap: number

	// ---- theme -----------------------------------------------------------
	/** Which of `BOOK_FONTS` to set the book in. Reflowable books only. */
	font: string
	/** Text size as a percentage of the book's own. Reflowable books only. */
	textScale: number
	/** The colour of the words. Reflowable books only — a PDF's ink is part of its picture. */
	textColor: string
	/** Line height multiplier applied to body text. Reflowable books only. */
	lineHeight: number
	/** The colour of the paper. */
	pageColor: string
	/** Width of one page, in CSS pixels. Reflowable books only. */
	pageWidth: number
	/** Height of one page, in CSS pixels. Reflowable books only. */
	pageHeight: number
	/** How rounded the corners of the paper are. */
	pageRadius: number
	/** Whether the paper casts a shadow, and a moving sheet one of its own. */
	pageShadow: boolean
	pageShadowColor: string
	/** How dark that shadow is, as a percentage. */
	pageShadowStrength: number
	/** Whether a two-page spread is drawn with a seam down its gutter. Reflowable books only. */
	pageSeam: boolean
	pageSeamColor: string
	pageSeamStrength: number
	/**
	 * The blank border left and right of the text, in pixels — and, in a spread, the gutter between
	 * the two columns, which the renderer draws as the same measure. Reflowable books only.
	 */
	marginX: number
	/** The blank border above and below the text, in pixels. Reflowable books only. */
	marginY: number
	/** Justify body text to both margins. Reflowable books only. */
	justify: boolean
	/** Let the browser hyphenate, which is what makes justified text bearable. Reflowable only. */
	hyphenate: boolean

	// ---- fixed layout ----------------------------------------------------
	/** Scale applied to the page size the reader would otherwise choose. Fixed-layout only. */
	zoom: number
	/** Pixels rendered per CSS pixel for a PDF page. Higher is sharper and slower. */
	renderScale: number
	/** How many pages either side of this one to draw before they are needed. PDFs only. */
	preloadPages: number

	// ---- tools -----------------------------------------------------------
	/** The tag put on a quote taken with the plain button. '' for none. */
	quoteTag: string
	/**
	 * Whether a new quote is related to its book. The relation is created *hidden* — it counts in
	 * every table and rollup, and no line is drawn across the board (see `createQuote.ts`).
	 */
	quoteArrow: boolean
	/** How strongly a highlight is painted over the words, as a percentage. */
	markOpacity: number
	/** How large a clipped page is rendered, against the width of the card it lands on. */
	clipScale: number
	/** Treat a superscript link as a footnote even when the book never says so. */
	detectFootnotes: boolean
	/** What a highlight can be called, and what colour each name means. */
	tags: HighlightTag[]
}

/**
 * A named look, as a handful of colours.
 *
 * Only the colours: a theme should not have opinions about your text size or the width of your
 * page, which are about your eyes and your screen rather than about how the book looks. Picking
 * one leaves everything else exactly as you had it.
 */
export interface ReaderTheme {
	id: string
	label: string
	pageColor: string
	textColor: string
	pageShadowColor: string
	pageSeamColor: string
}

export const READER_THEMES: readonly ReaderTheme[] = [
	{
		id: 'default',
		label: 'Default',
		// White paper, and only this theme is: the tint belongs to Paper, which is the theme whose
		// whole point is that it is not white.
		pageColor: '#ffffff',
		textColor: '#1a1a1a',
		pageShadowColor: '#000000',
		pageSeamColor: '#000000',
	},
	{
		id: 'paper',
		label: 'Paper',
		pageColor: '#efe4cd',
		textColor: '#33291c',
		pageShadowColor: '#4a3a1f',
		pageSeamColor: '#4a3a1f',
	},
	{
		id: 'dark',
		label: 'Dark',
		pageColor: '#1c1c20',
		textColor: '#cbc7bf',
		pageShadowColor: '#000000',
		pageSeamColor: '#000000',
	},
]

export const DEFAULT_SETTINGS: ReaderSettings = {
	viewMode: 'page',
	theme: 'default',

	// Curl rather than slide: two of the settings beside it mean nothing otherwise, and it is the
	// turn this reader is built around.
	pageTurn: 'curl',
	turnMs: 580,
	curlAngle: 16,
	curlRadius: 5,
	coverAlone: true,
	scrollGap: 16,

	// Not "Original": most EPUBs either specify nothing (and fall to the browser's Times) or specify
	// something chosen for a different device. A face drawn for reading is the better starting point,
	// and "Original" is one menu item away for a book whose typography is worth keeping.
	font: 'literata',
	textScale: 100,
	textColor: '#1a1a1a',
	lineHeight: 1.5,
	pageColor: '#ffffff',
	pageWidth: 620,
	// Paperback proportions off the default width (620 × 1.55 ≈ 961), landed on the slider's own
	// step so that the default is a value the control can actually express.
	pageHeight: 960,
	pageRadius: 2,
	pageShadow: true,
	pageShadowColor: '#000000',
	pageShadowStrength: 45,
	pageSeam: true,
	pageSeamColor: '#000000',
	pageSeamStrength: 4,
	// Tighter than the renderer's own 48: at this page width a 48px border either side costs a line
	// most of its length, and the sheet reads as a column floating on a card rather than as a page.
	marginX: 32,
	marginY: 32,
	justify: false,
	hyphenate: true,

	zoom: 100,
	renderScale: 2,
	preloadPages: 6,

	quoteTag: '',
	quoteArrow: true,
	markOpacity: 35,
	clipScale: 2,
	detectFootnotes: true,
	// The colours are the hues the label hash used to give these four, so nothing looks different
	// until someone changes it — but every one of them is now a value you can edit.
	tags: [
		{ label: 'Key', hue: 42 },
		{ label: 'Question', hue: 197 },
		{ label: 'Disagree', hue: 4 },
		{ label: 'Follow up', hue: 265 },
	],
}

/** Which engine a control means anything for. */
export type Engine = 'reflowable' | 'fixed'

/**
 * Which set of controls a format answers to, or null when it answers to none.
 *
 * A comic is the null case, and genuinely so: its pages are images of a fixed size that the reader
 * scales to the window, so there is no text to resize and no page size to choose. Both comic
 * containers answer alike — what is inside them is the same pile of images either way.
 *
 * Takes the `format` prop as it is stored — a plain string, like every shape prop — and routes it
 * the same way the reader itself does: PDF one way, everything else the other.
 */
export function engineFor(format: string): Engine | null {
	if (format === 'pdf') return 'fixed'
	if (format === 'cbz' || format === 'cbr') return null
	return 'reflowable'
}

/** Everything a control can be. */
export type ControlKind = 'slider' | 'toggle' | 'select' | 'colour'

export interface ReaderControl {
	key: keyof ReaderSettings
	label: string
	kind: ControlKind
	/** Which page of the settings it belongs on. */
	group: 'layout' | 'theme' | 'tools'
	/** The heading it sits under on that page. */
	section: string
	/** Which engine it bites on, or null for both. */
	engine: Engine | null
	/** Which layout it applies to, when it applies to only one. */
	viewMode?: ViewMode
	min?: number
	max?: number
	step?: number
	options?: readonly { id: string; label: string }[]
	format?(value: number): string
	note?: string
}

/**
 * Every control, in one list, ordered as the panel shows them.
 *
 * One list rather than several because the panel's job is only to filter it — by group, by engine,
 * and by whether the layout in question is on screen. A control that cannot bite is not rendered
 * at all: a slider that silently does nothing is worse than no slider.
 */
export const READER_CONTROLS: readonly ReaderControl[] = [
	// ---- layout ----------------------------------------------------------
	{
		key: 'pageTurn',
		label: 'Page turn',
		kind: 'select',
		group: 'layout',
		section: 'Page turn',
		engine: null,
		options: PAGE_TURNS,
	},
	{
		key: 'turnMs',
		label: 'Turn speed',
		kind: 'slider',
		group: 'layout',
		section: 'Page turn',
		engine: null,
		min: 150,
		max: 900,
		step: 20,
		format: (value) => `${value} ms`,
		note: 'Slide uses the renderer’s pace; Peel and Curl obey this setting.',
	},
	{
		key: 'curlAngle',
		label: 'Curl angle',
		kind: 'slider',
		group: 'layout',
		section: 'Page turn',
		engine: null,
		min: 0,
		max: 40,
		step: 1,
		format: (value) => `${value}°`,
		note: 'How far the fold leans. A real page lifts from its corner, not its edge.',
	},
	{
		key: 'curlRadius',
		label: 'Curl tightness',
		kind: 'slider',
		group: 'layout',
		section: 'Page turn',
		engine: null,
		min: 3,
		max: 26,
		step: 1,
		format: (value) => `${value}%`,
	},
	{
		key: 'coverAlone',
		label: 'Cover stands alone',
		kind: 'toggle',
		group: 'layout',
		section: 'Two pages',
		engine: 'fixed',
		viewMode: 'spread',
		note: 'The first page on its own, the way the cover of a real book faces nothing.',
	},
	{
		key: 'scrollGap',
		label: 'Gap between pages',
		kind: 'slider',
		group: 'layout',
		section: 'Endless',
		engine: 'fixed',
		viewMode: 'scroll',
		min: 0,
		max: 64,
		step: 2,
		format: (value) => `${value} px`,
	},
	{
		key: 'zoom',
		label: 'Zoom',
		kind: 'slider',
		group: 'layout',
		section: 'Rendering',
		engine: 'fixed',
		min: 50,
		max: 200,
		step: 5,
		format: (value) => `${value}%`,
	},
	{
		key: 'renderScale',
		label: 'Render quality',
		kind: 'slider',
		group: 'layout',
		section: 'Rendering',
		engine: 'fixed',
		min: 1,
		max: 3,
		step: 0.5,
		format: (value) => `${value}×`,
		note: 'Pixels drawn per pixel of screen. Higher is sharper and slower to draw.',
	},
	{
		key: 'preloadPages',
		label: 'Preload pages',
		kind: 'slider',
		group: 'layout',
		section: 'Rendering',
		engine: 'fixed',
		min: 0,
		max: 20,
		step: 1,
		format: (value) => (value ? `${value} each way` : 'off'),
		note: 'Pages drawn before you reach them, so a turn never waits for one. Held to a memory budget.',
	},

	// ---- theme -----------------------------------------------------------
	{ key: 'font', label: 'Font', kind: 'select', group: 'theme',
		section: 'Text', engine: 'reflowable' },
	{
		key: 'textScale',
		label: 'Font size',
		kind: 'slider',
		group: 'theme',
		section: 'Text',
		engine: 'reflowable',
		min: 70,
		max: 200,
		step: 5,
		format: (value) => `${value}%`,
	},
	{ key: 'textColor', label: 'Font colour', kind: 'colour', group: 'theme',
		section: 'Text', engine: 'reflowable' },
	{
		key: 'lineHeight',
		label: 'Line spacing',
		kind: 'slider',
		group: 'theme',
		section: 'Text',
		engine: 'reflowable',
		min: 1.2,
		max: 2.2,
		step: 0.1,
		format: (value) => value.toFixed(1),
	},
	{ key: 'pageColor', label: 'Page colour', kind: 'colour', group: 'theme',
		section: 'Paper', engine: 'reflowable' },
	{
		key: 'pageWidth',
		label: 'Page width',
		kind: 'slider',
		group: 'theme',
		section: 'Paper',
		engine: 'reflowable',
		min: 380,
		max: 900,
		step: 20,
		format: (value) => `${value} px`,
	},
	{
		key: 'pageHeight',
		label: 'Page height',
		kind: 'slider',
		group: 'theme',
		section: 'Paper',
		engine: 'reflowable',
		min: 400,
		max: 1400,
		step: 20,
		format: (value) => `${value} px`,
	},
	{
		key: 'pageRadius',
		label: 'Corner radius',
		kind: 'slider',
		group: 'theme',
		section: 'Paper',
		engine: null,
		min: 0,
		max: 24,
		step: 1,
		format: (value) => `${value} px`,
	},
	{ key: 'pageShadow', label: 'Page shadow', kind: 'toggle', group: 'theme',
		section: 'Shadow and seam', engine: null },
	{
		key: 'pageShadowColor',
		label: 'Shadow colour',
		kind: 'colour',
		group: 'theme',
		section: 'Shadow and seam',
		engine: null,
	},
	{
		key: 'pageShadowStrength',
		label: 'Shadow strength',
		kind: 'slider',
		group: 'theme',
		section: 'Shadow and seam',
		engine: null,
		min: 0,
		max: 100,
		step: 5,
		format: (value) => `${value}%`,
	},
	{
		key: 'pageSeam',
		label: 'Page seam',
		kind: 'toggle',
		group: 'theme',
		section: 'Shadow and seam',
		engine: 'reflowable',
		viewMode: 'spread',
	},
	{
		key: 'pageSeamColor',
		label: 'Seam colour',
		kind: 'colour',
		group: 'theme',
		section: 'Shadow and seam',
		engine: 'reflowable',
		viewMode: 'spread',
	},
	{
		key: 'pageSeamStrength',
		label: 'Seam strength',
		kind: 'slider',
		group: 'theme',
		section: 'Shadow and seam',
		engine: 'reflowable',
		viewMode: 'spread',
		min: 0,
		max: 30,
		step: 1,
		format: (value) => `${value}%`,
	},
	{
		key: 'marginX',
		label: 'Page margin X',
		kind: 'slider',
		group: 'theme',
		section: 'Margins',
		engine: 'reflowable',
		min: 0,
		max: 160,
		step: 4,
		format: (value) => `${value} px`,
		note: 'The blank border either side of the text, and the gutter between two facing pages — one measure, the way a book is set. At zero the text runs to the edge of the paper.',
	},
	{
		key: 'marginY',
		label: 'Page margin Y',
		kind: 'slider',
		group: 'theme',
		section: 'Margins',
		engine: 'reflowable',
		min: 0,
		max: 160,
		step: 4,
		format: (value) => `${value} px`,
	},
	{ key: 'justify', label: 'Justify text', kind: 'toggle', group: 'theme',
		section: 'Text', engine: 'reflowable' },
	{ key: 'hyphenate', label: 'Hyphenate', kind: 'toggle', group: 'theme',
		section: 'Text', engine: 'reflowable' },

	// ---- tools -----------------------------------------------------------
	{
		key: 'quoteTag',
		label: 'Default tag',
		kind: 'select',
		group: 'tools',
		section: 'Quotes',
		engine: null,
		// Options resolved by the panel, like the font list: the tags belong to the quote node, and
		// reaching for them from here is a circle — that module already reads its settings from this
		// one, and the two would race to initialise.
		note: 'What the plain quote button marks a passage as. The coloured buttons beside it always win.',
	},
	{
		key: 'quoteArrow',
		label: 'Link to the book',
		kind: 'toggle',
		group: 'tools',
		section: 'Quotes',
		engine: null,
		note: 'Relates a new quote to its book. The relation is hidden — tables and rollups count it, but no arrow is drawn. Show it with the eye button, or with "All relations".',
	},
	{
		key: 'markOpacity',
		label: 'Highlight strength',
		kind: 'slider',
		group: 'tools',
		section: 'Quotes',
		engine: null,
		min: 10,
		max: 70,
		step: 5,
		format: (value) => `${value}%`,
		note: 'How heavily a highlight is painted over the words it covers.',
	},
	{
		key: 'clipScale',
		label: 'Clip resolution',
		kind: 'slider',
		group: 'tools',
		section: 'Clips',
		engine: 'fixed',
		min: 1,
		max: 4,
		step: 0.5,
		format: (value) => `${value}×`,
		note: 'How large a clipped region is rendered, against the width of the card it lands on.',
	},
	{
		key: 'detectFootnotes',
		label: 'Detect unmarked notes',
		kind: 'toggle',
		group: 'tools',
		section: 'Footnotes',
		engine: 'reflowable',
		note: 'Treat a superscript link as a footnote even when the book never declares it as one.',
	},
]

/**
 * Whether to animate a page turn *now*: the setting, unless the reader has said it does not want
 * motion. Someone who gets motion sick from a sliding page has usually said so at the OS level
 * already, and an animation is exactly the kind of thing that setting exists for.
 */
export function animatesPageTurns(settings: ReaderSettings): boolean {
	if (settings.pageTurn === 'none') return false
	if (typeof matchMedia !== 'function') return true
	return !matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** A colour with an alpha, for the shadows and seams that are drawn from a strength as well. */
export function withAlpha(colour: string, percent: number): string {
	const hex = colour.replace('#', '')
	const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex
	const value = Number.parseInt(full, 16)
	if (!Number.isFinite(value) || full.length !== 6) return `rgb(0 0 0 / ${percent}%)`
	// eslint-disable-next-line no-bitwise
	return `rgb(${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255} / ${percent}%)`
}

/** The theme a set of colours corresponds to, or 'custom' when it matches none of them. */
export function themeOf(settings: ReaderSettings): string {
	const found = READER_THEMES.find(
		(theme) =>
			theme.pageColor === settings.pageColor &&
			theme.textColor === settings.textColor &&
			theme.pageShadowColor === settings.pageShadowColor &&
			theme.pageSeamColor === settings.pageSeamColor
	)
	return found?.id ?? 'custom'
}

/** The colours of a theme, as a patch to apply. */
export function themePatch(theme: ReaderTheme): Partial<ReaderSettings> {
	return {
		theme: theme.id,
		pageColor: theme.pageColor,
		textColor: theme.textColor,
		pageShadowColor: theme.pageShadowColor,
		pageSeamColor: theme.pageSeamColor,
	}
}

const KEY = 'lifeboard:reader'
/** The view mode had a key of its own before the rest of these existed. */
const LEGACY_VIEW_MODE_KEY = 'lifeboard:readerViewMode'

/**
 * Reads the saved settings, falling back to the defaults for anything missing or out of range.
 *
 * Deliberately forgiving: this is a preference, and a value that has been hand-edited, written by
 * an older build or lost to a cleared profile must never stop a book from opening.
 */
export function loadReaderSettings(): ReaderSettings {
	const stored = read(KEY)
	const parsed = stored ? safeParse(stored) : null
	const settings: ReaderSettings = { ...DEFAULT_SETTINGS }

	settings.viewMode = pickViewMode(parsed?.viewMode ?? read(LEGACY_VIEW_MODE_KEY))

	for (const control of READER_CONTROLS) {
		const value = parsed?.[control.key]
		if (control.kind === 'slider' && typeof value === 'number' && Number.isFinite(value)) {
			settings[control.key] = clampTo(control, value) as never
		} else if (control.kind === 'toggle' && typeof value === 'boolean') {
			settings[control.key] = value as never
		} else if (control.kind === 'colour' && isColour(value)) {
			settings[control.key] = value as never
		} else if (control.kind === 'select' && typeof value === 'string') {
			// A menu whose options live here is checked against them; the two whose options come
			// from elsewhere (the fonts, the quote tags) are checked below or left to their owners.
			const known = !control.options || control.options.some((o) => o.id === value)
			if (known) settings[control.key] = value as never
		}
	}

	const tags = parsed?.tags
	if (Array.isArray(tags)) {
		const clean = tags
			.filter(
				(tag): tag is HighlightTag =>
					!!tag &&
					typeof (tag as HighlightTag).label === 'string' &&
					!!(tag as HighlightTag).label.trim() &&
					Number.isFinite((tag as HighlightTag).hue)
			)
			.map((tag) => ({ label: tag.label.trim(), hue: ((tag.hue % 360) + 360) % 360 }))
		// An empty list would leave the quote bar with no buttons and no way back, so the defaults
		// stand until there is at least one real tag.
		if (clean.length) settings.tags = clean
	}

	// After the loop, so that a hand-edited font or page turn cannot slip past on the way through.
	settings.font = BOOK_FONTS.find((option) => option.id === settings.font)?.id ?? DEFAULT_SETTINGS.font
	settings.pageTurn =
		PAGE_TURNS.find((option) => option.id === settings.pageTurn)?.id ?? DEFAULT_SETTINGS.pageTurn
	settings.theme = themeOf(settings)
	return settings
}

export function saveReaderSettings(settings: ReaderSettings): void {
	try {
		localStorage.setItem(KEY, JSON.stringify(settings))
	} catch {
		// Losing the preference across reloads is fine; failing to change the setting is not.
	}
}

/** A value snapped to its control's range and step, so a slider can never save something unusable. */
export function clampTo(control: ReaderControl, value: number): number {
	const step = control.step ?? 1
	const stepped = Math.round(value / step) * step
	const bounded = Math.min(control.max ?? stepped, Math.max(control.min ?? stepped, stepped))
	// `0.1` steps land on 1.5000000000000002 without this.
	return Math.round(bounded * 1000) / 1000
}

function isColour(value: unknown): value is string {
	return typeof value === 'string' && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value)
}

function read(key: string): string | null {
	try {
		return localStorage.getItem(key)
	} catch {
		// Private-mode Safari, and the node path in tests.
		return null
	}
}

function safeParse(value: string): Partial<Record<keyof ReaderSettings, unknown>> | null {
	try {
		const parsed: unknown = JSON.parse(value)
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
	} catch {
		return null
	}
}

function pickViewMode(value: unknown): ViewMode {
	return VIEW_MODES.find((mode) => mode === value) ?? DEFAULT_SETTINGS.viewMode
}
