import ebGaramondItalic from '@fontsource-variable/eb-garamond/files/eb-garamond-latin-wght-italic.woff2?url'
import ebGaramondNormal from '@fontsource-variable/eb-garamond/files/eb-garamond-latin-wght-normal.woff2?url'
import literataItalic from '@fontsource-variable/literata/files/literata-latin-wght-italic.woff2?url'
import literataNormal from '@fontsource-variable/literata/files/literata-latin-wght-normal.woff2?url'
import openSansItalic from '@fontsource-variable/open-sans/files/open-sans-latin-wght-italic.woff2?url'
import openSansNormal from '@fontsource-variable/open-sans/files/open-sans-latin-wght-normal.woff2?url'
import sourceSerifItalic from '@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-italic.woff2?url'
import sourceSerifNormal from '@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-normal.woff2?url'

/**
 * The reading faces, all of them open-licensed (SIL OFL 1.1) and shipped with the app.
 *
 * Bundled rather than named-and-hoped-for, because the alternative is a book that looks different
 * on every machine: the faces a reader actually wants are the ones a given OS happens to have, and
 * asking for a font the machine lacks silently falls back to the browser's Times. Self-hosting also
 * keeps the reader working offline and asks nothing of a font CDN, which is the same reason the
 * rest of the app does not phone home.
 *
 * They are variable fonts with a weight axis and a real italic, which is what a book needs: the
 * emphasis, the epigraphs and the headings all have to be genuine cuts rather than the browser
 * slanting and smearing the roman.
 */
interface BundledFont {
	id: string
	label: string
	family: string
	normal: string
	italic: string
	/** What to use if the bundled file somehow fails, ending in a generic. */
	fallback: string
	note: string
}

const BUNDLED: readonly BundledFont[] = [
	{
		id: 'literata',
		label: 'Literata',
		family: 'Literata',
		normal: literataNormal,
		italic: literataItalic,
		fallback: `Georgia, serif`,
		note: 'A contemporary reading serif, drawn for long-form text on screens.',
	},
	{
		id: 'source-serif',
		label: 'Source Serif',
		family: 'Source Serif 4',
		normal: sourceSerifNormal,
		italic: sourceSerifItalic,
		fallback: `Charter, Georgia, serif`,
		note: 'A transitional serif in the Charter tradition — even colour, open shapes.',
	},
	{
		id: 'eb-garamond',
		label: 'EB Garamond',
		family: 'EB Garamond',
		normal: ebGaramondNormal,
		italic: ebGaramondItalic,
		fallback: `Palatino, "Palatino Linotype", Georgia, serif`,
		note: 'A classical old-style face, for a book that wants to look like a book.',
	},
	{
		id: 'open-sans',
		label: 'Open Sans',
		family: 'Open Sans',
		normal: openSansNormal,
		italic: openSansItalic,
		fallback: `system-ui, sans-serif`,
		note: 'A humanist sans, for anyone who reads better without serifs.',
	},
]

export interface BookFont {
	id: string
	label: string
	/** A `font-family` value, or '' to leave the publisher's own typography alone. */
	stack: string
	note: string
}

export const BOOK_FONTS: readonly BookFont[] = [
	{
		id: 'original',
		label: 'Original',
		stack: '',
		note: 'Whatever the publisher chose for this book.',
	},
	...BUNDLED.map(
		(font): BookFont => ({
			id: font.id,
			label: font.label,
			stack: `"${font.family}", ${font.fallback}`,
			note: font.note,
		})
	),
]

/** The stack for a saved font id — '' for "Original", and for an id we no longer ship. */
export function fontStack(id: string): string {
	return BOOK_FONTS.find((font) => font.id === id)?.stack ?? ''
}

/**
 * The `@font-face` rules, with absolute URLs.
 *
 * Absolute is the whole point: these are injected into the book's own document, which the renderer
 * serves from a `blob:` URL, and a relative path there resolves against the blob rather than
 * against the app. The rules cost nothing until a face is actually used — a browser fetches a font
 * file only when something on the page matches it — so declaring all four is free.
 */
export function fontFaceCss(): string {
	return BUNDLED.map((font) =>
		[
			face(font.family, font.normal, 'normal'),
			face(font.family, font.italic, 'italic'),
		].join('\n')
	).join('\n')
}

function face(family: string, url: string, style: 'normal' | 'italic'): string {
	return `@font-face {
	font-family: "${family}";
	font-style: ${style};
	font-weight: 200 900;
	font-display: swap;
	src: url("${absolute(url)}") format("woff2-variations");
}`
}

const APP_STYLE_ID = 'lb-book-fonts'

/**
 * Makes the same faces available to the app's own document, so the settings panel can show you a
 * line of each one. Injected once, and only when a panel that needs it is first opened — nothing
 * downloads until a face is actually rendered.
 */
export function ensureAppFontFaces(): void {
	if (typeof document === 'undefined' || document.getElementById(APP_STYLE_ID)) return
	const style = document.createElement('style')
	style.id = APP_STYLE_ID
	style.textContent = fontFaceCss()
	document.head.append(style)
}

function absolute(url: string): string {
	// `location` is absent under the test runner, where the URL is never resolved anyway.
	return typeof location === 'undefined' ? url : new URL(url, location.href).href
}
