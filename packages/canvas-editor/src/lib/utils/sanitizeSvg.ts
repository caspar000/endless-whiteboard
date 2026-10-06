/**
 * An SVG with everything that could run or reach out taken out (docs/fork-parity.md X1), for SVG that
 * arrives by paste or drop. A picture keeps its shapes, paths, gradients, text and embedded raster
 * images; it loses scripts, event handlers, `javascript:` and other outside links, HTML islands
 * (`foreignObject`), frames and plugins, and animations that would rewrite a link or a handler.
 *
 * An `<img>` never runs an SVG's scripts, but an SVG is not only ever shown that way: measuring one
 * puts it in the page, and opening a stored picture in a tab shows it as a document on this origin.
 *
 * Returns `null` for text that isn't an SVG document.
 *
 * @public
 */
export function sanitizeSvg(text: string): string | null {
	const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
	const root = doc.documentElement
	if (!root || root.localName !== 'svg' || doc.getElementsByTagName('parsererror').length) return null

	for (const element of Array.from(root.querySelectorAll('*')).concat(root)) {
		if (!element.isConnected && element !== root) continue
		const name = element.localName.toLowerCase()
		if (REMOVED.has(name) || (ANIMATIONS.has(name) && animatesSomethingUnsafe(element))) {
			element.remove()
			continue
		}
		for (const attribute of Array.from(element.attributes)) {
			const attr = attribute.name.toLowerCase()
			if (attr.startsWith('on')) element.removeAttributeNode(attribute)
			else if (LINKS.has(attr.replace(/^xlink:/, '')) && !isSafeReference(attribute.value)) {
				element.removeAttributeNode(attribute)
			} else if (attr === 'style' && hasOutsideUrl(attribute.value)) {
				element.setAttribute('style', withoutOutsideUrls(attribute.value))
			}
		}
		if (name === 'style') element.textContent = withoutOutsideUrls(element.textContent ?? '')
	}

	return new XMLSerializer().serializeToString(root)
}

/** Elements that run code, hold another document, or embed HTML. */
const REMOVED = new Set(['script', 'foreignobject', 'iframe', 'frame', 'embed', 'object', 'applet', 'meta', 'link', 'base', 'handler', 'listener'])

const ANIMATIONS = new Set(['set', 'animate', 'animatemotion', 'animatetransform', 'animatecolor'])

/** Attributes that point somewhere. */
const LINKS = new Set(['href', 'src', 'action', 'formaction'])

/** An animation that would set a link or a handler, which is how `javascript:` slips back in. */
function animatesSomethingUnsafe(element: Element): boolean {
	const target = (element.getAttribute('attributeName') ?? '').toLowerCase().replace(/^xlink:/, '')
	return target === 'href' || target.startsWith('on') || target === 'src'
}

/** A link inside the picture (`#id`) or an embedded raster image; nothing that leaves the file. */
function isSafeReference(value: string): boolean {
	const v = value.trim().toLowerCase()
	return v.startsWith('#') || /^data:image\/(png|jpe?g|gif|webp|avif);/.test(v)
}

const URL_PATTERN = /url\(\s*(['"]?)(.*?)\1\s*\)/gi

function hasOutsideUrl(css: string): boolean {
	return /@import/i.test(css) || [...css.matchAll(URL_PATTERN)].some((m) => !isSafeReference(m[2] ?? ''))
}

/** CSS with every `url(…)` that leaves the file, and every `@import`, emptied. */
function withoutOutsideUrls(css: string): string {
	return css
		.replace(/@import[^;]*;?/gi, '')
		.replace(URL_PATTERN, (match, _quote, url: string) => (isSafeReference(url) ? match : 'none'))
}
