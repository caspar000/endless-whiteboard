import type { TLAsset } from '@tldraw/tlschema'
import { rgbaToThumbHash, thumbHashToDataURL } from 'thumbhash'

/**
 * Blurred placeholders for pictures (docs/image-loading-plan.md). A ThumbHash is about 25 bytes that
 * decode to a blurred copy of the picture, aspect ratio and transparency included. It is kept as
 * base64 in the asset record's `meta.thumbhash`, so it travels with the board and shows before the
 * picture's bytes have arrived.
 */

/** ThumbHash encodes pictures of at most this many pixels on a side. */
const MAX_SIDE = 100

/** The picture's ThumbHash as base64, or `null` if it can't be read (a tainted or empty bitmap). */
export function encodeThumbHash(source: ImageBitmap): string | null {
	const scale = Math.min(1, MAX_SIDE / Math.max(source.width, source.height))
	const w = Math.max(1, Math.round(source.width * scale))
	const h = Math.max(1, Math.round(source.height * scale))
	const canvas = document.createElement('canvas')
	canvas.width = w
	canvas.height = h
	const ctx = canvas.getContext('2d')
	if (!ctx) return null
	try {
		ctx.drawImage(source, 0, 0, w, h)
		const bytes = rgbaToThumbHash(w, h, ctx.getImageData(0, 0, w, h).data)
		return btoa(String.fromCharCode(...bytes))
	} catch {
		return null
	}
}

/** Decoded once per hash: the same picture is often on screen many times. */
const urls = new Map<string, string | null>()

/** A ThumbHash as a PNG data URL, or `null` for one that doesn't decode. */
export function thumbHashUrl(thumbhash: string): string | null {
	let url = urls.get(thumbhash)
	if (url === undefined) {
		try {
			url = thumbHashToDataURL(Uint8Array.from(atob(thumbhash), (c) => c.charCodeAt(0)))
		} catch {
			url = null
		}
		urls.set(thumbhash, url)
	}
	return url
}

/** The blurred placeholder kept with an asset, as a data URL, or `null` if it has none. */
export function getAssetPlaceholderUrl(asset: TLAsset | undefined): string | null {
	const thumbhash = asset?.meta.thumbhash
	return typeof thumbhash === 'string' ? thumbHashUrl(thumbhash) : null
}
