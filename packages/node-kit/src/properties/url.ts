/**
 * URL handling for the link node.
 *
 * Kept separate and tested because this is the one place the app turns *typed text* into something a
 * browser will navigate to. An `href` built straight from user input is an XSS hole — `javascript:` and
 * `data:` URLs execute in the page's origin — so the scheme is allow-listed rather than denied.
 */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/** Anything shaped like `scheme:` at the start — RFC 3986's production, near enough. */
const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

/**
 * The value safe to put in an `href`, or `null` if there isn't one.
 *
 * `null` is a real answer, not a failure: a link with no URL yet still renders, just as plain text
 * rather than as something clickable. Callers must not fall back to the raw string.
 */
export function normalizeUrl(raw: string): string | null {
	const trimmed = raw.trim()
	if (!trimmed) return null

	// "lifeboard.app" is what people type; assume the web's default scheme rather than rejecting it.
	// Anything that already declares a scheme is left alone so the allow-list below can judge it.
	const candidate = HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`

	let parsed: URL
	try {
		parsed = new URL(candidate)
	} catch {
		return null
	}
	if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return null
	// A scheme with nothing behind it ("https://") parses fine but goes nowhere.
	if (parsed.protocol !== 'mailto:' && !parsed.hostname) return null
	if (parsed.protocol === 'mailto:' && !parsed.pathname) return null
	return parsed.toString()
}

/** The short form shown under the name — the domain, or the address for a `mailto:`. */
export function linkHost(url: string): string {
	try {
		const parsed = new URL(url)
		if (parsed.protocol === 'mailto:') return parsed.pathname
		return parsed.host.replace(/^www\./, '')
	} catch {
		return ''
	}
}
