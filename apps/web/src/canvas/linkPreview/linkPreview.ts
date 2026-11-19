import type { JsonObject, TLBookmarkAsset, TLBookmarkShape } from '@lifeboard/canvas'

/**
 * A link card's own changes: the name, picture and crop someone chose for this one card.
 *
 * What the page says about itself (its name, picture, icon) is the card's asset, shared by every
 * card of the same address and replaced when it's fetched again. What a person changed is the
 * card's, so it lives in `meta` — free-form, no migration, as the geo shape's fill colour does
 * (`shapeFill.ts`) — and wins over the asset's. One key holding one object, written whole, because a
 * partial can't delete a `meta` key: an empty object is "nothing changed".
 */
export const LINK_PREVIEW_META = 'linkPreview'

export interface LinkPreviewEdits {
	/** The card's name, in place of the page's. */
	title?: string
	/** A picture of the board's own (`asset:<hash>`) in place of the page's. */
	image?: string
	/** The point of the picture the square crop is centred on, each 0–1. Absent is the middle. */
	focus?: [number, number]
}

/** A new card's side. Square, as the picture is shown. */
export const LINK_PREVIEW_SIZE = 280

export function readEdits(shape: TLBookmarkShape): LinkPreviewEdits {
	const raw = shape.meta[LINK_PREVIEW_META]
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
	const { title, image, focus } = raw as Record<string, unknown>
	const edits: LinkPreviewEdits = {}
	if (typeof title === 'string') edits.title = title
	if (typeof image === 'string' && image) edits.image = image
	if (Array.isArray(focus) && focus.length === 2 && focus.every((n) => typeof n === 'number' && Number.isFinite(n))) {
		edits.focus = [clamp01(focus[0] as number), clamp01(focus[1] as number)]
	}
	return edits
}

/** The `meta` patch that sets these edits, leaving out what is unset. */
export function editsMeta(edits: LinkPreviewEdits): { [LINK_PREVIEW_META]: JsonObject } {
	const next: JsonObject = {}
	if (edits.title !== undefined) next.title = edits.title
	if (edits.image) next.image = edits.image
	if (edits.focus) next.focus = edits.focus
	return { [LINK_PREVIEW_META]: next }
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/** The site a card is from, as people say it: `audeze.com`, not `www.audeze.com`. */
export function linkDomain(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, '')
	} catch {
		return ''
	}
}

/** The address in full, as the hover shows it, without the scheme's noise or a trailing slash. */
export function readableAddress(url: string): string {
	try {
		const parsed = new URL(url)
		return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname.replace(/\/$/, '')}${parsed.search}`
	} catch {
		return url
	}
}

/**
 * An address someone typed, made whole: `audeze.com/lcd-2` is `https://audeze.com/lcd-2`. Only the
 * web, and only a name with a dot in it, which is what tells an address from a word.
 */
export function parseTypedUrl(text: string): string | null {
	const trimmed = text.trim()
	if (!trimmed) return null
	try {
		const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
		if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null
		return url.href
	} catch {
		return null
	}
}

/** What the card shows, its own changes over what the page said. */
export interface LinkPreviewContent {
	title: string
	domain: string
	address: string
	image: string
	/** The page's own picture, which "Use the page's picture" goes back to. */
	pageImage: string
	favicon: string
	focus: [number, number]
}

export function linkPreviewContent(shape: TLBookmarkShape, asset: TLBookmarkAsset | null): LinkPreviewContent {
	const edits = readEdits(shape)
	const domain = linkDomain(shape.props.url)
	return {
		title: edits.title?.trim() || asset?.props.title?.trim() || domain || shape.props.url,
		domain,
		address: readableAddress(shape.props.url),
		image: edits.image ?? asset?.props.image ?? '',
		pageImage: asset?.props.image ?? '',
		favicon: asset?.props.favicon ?? '',
		focus: edits.focus ?? [0.5, 0.5],
	}
}

/**
 * `object-position` for a picture of this size, so the square crop is centred on the focus as far as
 * the picture allows. A wide picture slides sideways, a tall one up and down.
 */
export function cropPosition([fx, fy]: [number, number], width: number, height: number): string {
	if (!width || !height) return '50% 50%'
	const ratio = width / height
	const slide = (focus: number, visible: number) =>
		visible >= 1 ? 0.5 : clamp01((focus - visible / 2) / (1 - visible))
	const x = ratio > 1 ? slide(fx, 1 / ratio) : 0.5
	const y = ratio < 1 ? slide(fy, ratio) : 0.5
	return `${round(x * 100)}% ${round(y * 100)}%`
}

/** The part of the picture the square shows, as fractions of it — the inspector draws it. */
export function cropWindow([fx, fy]: [number, number], width: number, height: number) {
	const ratio = width && height ? width / height : 1
	const w = ratio > 1 ? 1 / ratio : 1
	const h = ratio < 1 ? ratio : 1
	return {
		left: clamp01(Math.min(Math.max(fx - w / 2, 0), 1 - w)),
		top: clamp01(Math.min(Math.max(fy - h / 2, 0), 1 - h)),
		width: w,
		height: h,
	}
}

const round = (n: number) => Math.round(n * 100) / 100

/** A colour of the site's own, for a card with no picture: the same site, the same colour. */
export function hueOf(text: string): number {
	let hue = 0
	for (const char of text) hue = (hue * 31 + char.charCodeAt(0)) % 360
	return hue
}
