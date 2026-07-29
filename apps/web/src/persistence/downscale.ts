/**
 * Import-time image downscaling — "the single biggest lever for snappiness and quota" (§4.4).
 *
 * A phone photo is 4-12 MB at 4000px wide; on a board it is displayed a few hundred pixels wide.
 * Re-encoding at import to ≤2048px WebP typically cuts it by 10-40×, which shows up directly as
 * faster board loads, lower memory, and far more headroom before hitting the storage quota.
 */
export const MAX_EDGE = 2048
export const WEBP_QUALITY = 0.8

/**
 * How large a source file we accept for import, passed to `<Tldraw maxAssetSize>`.
 *
 * tldraw defaults this to 10 MB and rejects anything bigger *before* the asset store's `upload()`
 * runs — so with the default, exactly the oversized phone photos this downscaling exists for were
 * silently dropped (no shape, no error, just a toast). Since we re-encode on import, the source size
 * barely matters; what lands in storage is bounded by MAX_EDGE and WEBP_QUALITY instead.
 *
 * Still bounded rather than unlimited: a genuinely enormous file would spend a long time being
 * hashed and re-encoded on the main thread, and rejecting it with tldraw's built-in toast is a
 * better outcome than a frozen tab.
 */
export const MAX_IMPORT_BYTES = 64 * 1024 * 1024

export interface DownscaleResult {
	blob: Blob
	width: number
	height: number
	/** True when we re-encoded; false when the original was returned untouched. */
	changed: boolean
}

/** Formats we can safely re-encode. SVG is vector (rasterising would lose quality); GIF may be
 * animated (canvas would keep only the first frame). Both pass through unchanged. */
function isReencodable(type: string): boolean {
	return type === 'image/jpeg' || type === 'image/png' || type === 'image/webp' || type === 'image/avif'
}

export async function downscaleImage(
	file: Blob,
	opts: { maxEdge?: number; quality?: number } = {}
): Promise<DownscaleResult> {
	const maxEdge = opts.maxEdge ?? MAX_EDGE
	const quality = opts.quality ?? WEBP_QUALITY

	if (!isReencodable(file.type)) {
		const size = await probeSize(file)
		return { blob: file, width: size.width, height: size.height, changed: false }
	}

	let bitmap: ImageBitmap
	try {
		bitmap = await createImageBitmap(file)
	} catch {
		// A corrupt or unsupported image: store it as-is rather than failing the paste.
		return { blob: file, width: 0, height: 0, changed: false }
	}

	try {
		const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
		const width = Math.max(1, Math.round(bitmap.width * scale))
		const height = Math.max(1, Math.round(bitmap.height * scale))

		const canvas = document.createElement('canvas')
		canvas.width = width
		canvas.height = height
		const ctx = canvas.getContext('2d')
		if (!ctx) return { blob: file, width: bitmap.width, height: bitmap.height, changed: false }
		ctx.drawImage(bitmap, 0, 0, width, height)

		const encoded = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, 'image/webp', quality)
		)

		// Keep the original when re-encoding didn't help — true for already-optimised small images,
		// where WebP can come out larger than the source.
		if (!encoded || encoded.size >= file.size) {
			return { blob: file, width: bitmap.width, height: bitmap.height, changed: false }
		}

		return { blob: encoded, width, height, changed: true }
	} finally {
		bitmap.close()
	}
}

async function probeSize(file: Blob): Promise<{ width: number; height: number }> {
	try {
		const bitmap = await createImageBitmap(file)
		const size = { width: bitmap.width, height: bitmap.height }
		bitmap.close()
		return size
	} catch {
		return { width: 0, height: 0 }
	}
}
