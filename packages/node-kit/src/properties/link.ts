import { linkHost, normalizeUrl } from './url'
import type { PropertyValue } from './types'

/**
 * The `link` property type: a title and a URL, stored in one value.
 *
 * Encoded as markdown's own link syntax — `[title](url)`, or a bare URL when there is no title —
 * rather than as an object, because property values are bounded to JSON scalars and string lists
 * (§7). That bound is load-bearing: `areValueRecordsEqual` compares exactly one level deep, which is
 * what keeps dragging free of rollup recomputes. An object value would have quietly broken that for
 * every property, not just this one.
 *
 * Markdown's form in particular, rather than a private separator, because it is already the app's
 * text format: a link value pasted into a note is a working link, and a board exported to markdown
 * needs no special case.
 */
export interface LinkParts {
	title: string
	url: string
}

const EMPTY: LinkParts = { title: '', url: '' }

/** Greedy title so a `]` inside it survives the round trip; the last `](` is the real separator. */
const ENCODED = /^\[([\s\S]*)\]\(([\s\S]*)\)$/

export function parseLinkValue(value: PropertyValue): LinkParts {
	if (typeof value !== 'string' || value === '') return EMPTY
	const match = ENCODED.exec(value)
	if (match) return { title: match[1] ?? '', url: match[2] ?? '' }
	// A plain string is a URL someone typed before adding a title — including every value that was a
	// `url` property before it was changed to a `link`.
	return { title: '', url: value }
}

/** `null` when there is nothing to store, which is how every property type spells "empty". */
export function encodeLinkValue(parts: LinkParts): string | null {
	const title = parts.title.trim()
	const url = parts.url.trim()
	if (!title && !url) return null
	// No title: store the bare URL, so the value stays something a human can read in a backup.
	return title ? `[${title}](${url})` : url
}

/**
 * What to show for a link value — the title, or failing that the domain, or failing that the raw text.
 *
 * Never blank while a value exists: a row that renders as nothing reads as a bug rather than as an
 * empty field.
 */
export function linkDisplayText(value: PropertyValue): string {
	const { title, url } = parseLinkValue(value)
	if (title) return title
	const href = normalizeUrl(url)
	return (href && linkHost(href)) || url
}

/** The `href` for a link value, or `null` if there isn't a safe one. See `url.ts`. */
export function linkHref(value: PropertyValue): string | null {
	return normalizeUrl(parseLinkValue(value).url)
}
