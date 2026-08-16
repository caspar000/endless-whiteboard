import { downscaleImage } from '../persistence/downscale'
import type { PromptImage } from './protocol'

/**
 * Turning pasted pictures into something the model can read.
 *
 * Everything here exists because a clipboard image is the *worst* case for a JSON wire format: a
 * full-resolution screenshot is several megabytes, base64 adds a third on top, and it all travels
 * over a WebSocket as one string. So a paste is downscaled before it is encoded, capped in count,
 * and refused with a sentence rather than silently truncated.
 */

/**
 * Longest edge kept for a pasted image.
 *
 * Below the app's own 2048 import ceiling: a picture pasted into a chat is being *looked at* by a
 * model, not stored as canvas artwork, and Claude downsamples above roughly this size anyway — so
 * sending more is bytes on the wire that buy nothing.
 */
const MAX_EDGE = 1568

/** After downscaling. Comfortably under Anthropic's per-image limit once base64 inflates it. */
const MAX_BYTES = 3_500_000

/** More than this in one turn is a mis-paste, and the model reads them worse anyway. */
export const MAX_IMAGES = 5

export interface PendingImage extends PromptImage {
	id: string
	/** An object URL for the thumbnail. Revoked by the composer when the image is dropped. */
	previewUrl: string
	/** What to call it in the UI and to an assistive reader. */
	name: string
}

let counter = 0

/** The image files on a clipboard event, ignoring the text and HTML flavours alongside them. */
export function imageFilesFrom(data: DataTransfer | null): File[] {
	if (!data) return []
	return [...data.files].filter((file) => file.type.startsWith('image/'))
}

/**
 * Prepares one pasted file: downscale, encode, name.
 *
 * Returns `null` for anything that survives downscaling and is still too large — refusing one image
 * is better than sending a turn that the API rejects wholesale, taking the user's typed question
 * with it.
 */
export async function prepareImage(file: File): Promise<PendingImage | null> {
	const { blob } = await downscaleImage(file, { maxEdge: MAX_EDGE })
	if (blob.size > MAX_BYTES) return null

	const buffer = await blob.arrayBuffer()
	counter += 1

	return {
		id: `img-${counter}`,
		mediaType: blob.type || file.type || 'image/png',
		data: base64From(buffer),
		previewUrl: URL.createObjectURL(blob),
		// A pasted screenshot has no useful name of its own; the index is what distinguishes two of
		// them sitting side by side in the composer.
		name: file.name || `Pasted image ${counter}`,
	}
}

/**
 * Base64 without the data-URL prefix.
 *
 * Chunked rather than one `String.fromCharCode(...bytes)` spread: a multi-megabyte image is millions
 * of arguments, which overflows the call stack on every engine that has one.
 */
function base64From(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer)
	const CHUNK = 0x8000
	let binary = ''
	for (let i = 0; i < bytes.length; i += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
	}
	return btoa(binary)
}

/** A data URL for rendering a sent or replayed image, which carries no object URL of its own. */
export function dataUrlFor(image: PromptImage): string {
	return `data:${image.mediaType};base64,${image.data}`
}
