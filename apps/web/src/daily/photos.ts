import { react } from '@lifeboard/canvas'
import { useEffect, useState } from 'react'
import { createAssetBridge } from '../persistence/assetStore'
import { downscaleImage } from '../persistence/downscale'
import { sha256Hex } from '../persistence/hash'
import type { BlobStore } from '../platform/PlatformAdapter'
import { fetchServerAsset, isServerAvailable, missingServerAssets, uploadServerAsset } from '../server/serverVault'
import { pagePhotoHashes } from './model'
import { dailyPages } from './store'

/**
 * The food log's pictures (DARK-17), kept as a board's pictures are: downscaled, stored by the hash of
 * their bytes in this device's blob store, and sent to the server, so another device can show them.
 * The page keeps only the hash. Both clean-ups that delete files nothing uses read the daily pages too
 * (`boards/deleteBoard.ts`, the server's `gc.ts`), so a photo stays while its page does.
 */

/** Hashes this session knows the server has. */
const onServer = new Set<string>()

/** How many hashes one question to the server asks about: under its own limit of 5,000. */
const ASK_AT_ONCE = 1000

/**
 * Sends the pictures the server lacks, from every day asked about, not only the one on screen: a photo
 * taken offline on Monday has to reach the server whichever page is open when it answers again.
 * Without a server, or offline, they wait for the next time; one that fails is asked about again then.
 */
export async function sendPhotos(blobs: BlobStore, hashes: Iterable<string>): Promise<void> {
	const fresh = [...new Set(hashes)].filter((hash) => !onServer.has(hash))
	if (!fresh.length || !isServerAvailable()) return
	try {
		for (let at = 0; at < fresh.length; at += ASK_AT_ONCE) {
			const batch = fresh.slice(at, at + ASK_AT_ONCE)
			const missing = new Set(await missingServerAssets(batch))
			for (const hash of batch) {
				if (missing.has(hash)) {
					const blob = await blobs.get(hash)
					// One this device doesn't have is another device's to send.
					if (!blob) continue
					await uploadServerAsset(hash, blob)
				}
				onServer.add(hash)
			}
		}
	} catch (error) {
		console.warn('Lifeboard: could not send a food photo to the server; it is kept on this device.', error)
	}
}

/** How often photos still waiting are tried again while the app is open. */
const RETRY_MS = 5 * 60_000

/**
 * Keeps every daily page's photos on the server, whether or not the daily page is open: when a page
 * changes (here, or arriving from the vault), when the browser comes back online or the window back
 * into focus (which is also when the vault is read again), and every few minutes. Started once by the
 * app; returns its stop.
 */
export function startPhotoSync(blobs: BlobStore): () => void {
	const run = () => void sendPhotos(blobs, pagePhotoHashes(Object.values(dailyPages.get())))
	const stopReacting = react('lifeboard:daily-photo-sync', () => {
		dailyPages.get()
		// After the store change has settled, never inside it.
		queueMicrotask(run)
	})
	window.addEventListener('online', run)
	window.addEventListener('focus', run)
	const timer = setInterval(run, RETRY_MS)
	return () => {
		stopReacting()
		window.removeEventListener('online', run)
		window.removeEventListener('focus', run)
		clearInterval(timer)
	}
}

/** For tests: forget what the server was known to have. */
export function forgetSentPhotos(): void {
	onServer.clear()
}

/**
 * The kinds of picture the food log keeps: photos, which are re-encoded on the way in. Anything else is
 * refused, an SVG above all: it is a document that can run script, and the log opens its pictures in a
 * tab of the app's own origin (docs/fork-parity.md X1).
 */
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/heic', 'image/heif']

export function isPhotoType(type: string): boolean {
	return PHOTO_TYPES.includes(type.toLowerCase())
}

/** What the file picker offers. */
export const PHOTO_ACCEPT = PHOTO_TYPES.join(',')

/** Keeps a photo and returns its hash, or `null` for a file that isn't a photo. */
export async function storePhoto(blobs: BlobStore, file: Blob): Promise<string | null> {
	if (!isPhotoType(file.type)) return null
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
