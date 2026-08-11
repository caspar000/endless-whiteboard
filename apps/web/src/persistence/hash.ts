/**
 * SHA-256 content addressing for blobs (§4.4). Content addressing buys two things at once:
 * pasting the same photo onto two boards stores one blob, and re-importing a backup is idempotent.
 */
export async function sha256Hex(blob: Blob): Promise<string> {
	const buffer = await blob.arrayBuffer()
	const digest = await crypto.subtle.digest('SHA-256', buffer)
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
