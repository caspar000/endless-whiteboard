import { useEffect, useState } from 'react'
import { createAssetBridge } from '../persistence/assetStore'
import { downscaleImage } from '../persistence/downscale'
import { sha256Hex } from '../persistence/hash'
import type { BlobStore } from '../platform/PlatformAdapter'
import { fetchServerAsset, isServerAvailable, missingServerAssets, uploadServerAsset } from '../server/serverVault'

/**
 * The food log's pictures (DARK-17), kept as a board's pictures are: downscaled, stored by the hash of
 * their bytes in this device's blob store, and sent to the server, so another device can show them.
 * The page keeps only the hash. Both clean-ups that delete files nothing uses read the daily pages too
 * (`boards/deleteBoard.ts`, the server's `gc.ts`), so a photo stays while its page does.
 */

/** Hashes this session knows the server has. */
const onServer = new Set<string>()

/** Sends the pictures the server lacks. Without a server, or offline, they wait for the next time. */
export async function sendPhotos(blobs: BlobStore, hashes: readonly string[]): Promise<void> {
	const fresh = hashes.filter((hash) => !onServer.has(hash))
	if (!fresh.length || !isServerAvailable()) return
	try {
		const missing = new Set(await missingServerAssets(fresh))
		for (const hash of fresh) {
			if (missing.has(hash)) {
				const blob = await blobs.get(hash)
				// One this device doesn't have is another device's to send.
				if (!blob) continue
				await uploadServerAsset(hash, blob)
			}
			onServer.add(hash)
		}
	} catch (error) {
		console.warn('Lifeboard: could not send a food photo to the server; it is kept on this device.', error)
	}
}

/** Keeps a photo and returns its hash. */
export async function storePhoto(blobs: BlobStore, file: Blob): Promise<string> {
	const { blob } = await downscaleImage(file, { maxEdge: 1280 })
	const hash = await sha256Hex(blob)
	await blobs.put(hash, blob)
	void sendPhotos(blobs, [hash])
	return hash
}

/** A photo's address to draw it with, or `null` while it loads (or when no device has it any more). */
export function usePhotoUrl(blobs: BlobStore, hash: string): string | null {
	const [url, setUrl] = useState<string | null>(null)
	useEffect(() => {
		let live = true
		setUrl(null)
		void createAssetBridge(blobs, fetchServerAsset)
			.resolveUrl(`asset:${hash}`)
			.then((resolved) => live && setUrl(resolved))
			.catch(() => {})
		return () => {
			live = false
		}
	}, [blobs, hash])
	return url
}

/** `HH:MM` now. */
export function clockNow(date = new Date()): string {
	return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
