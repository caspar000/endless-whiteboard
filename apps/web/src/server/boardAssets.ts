import { collectAssetRefs } from '@lifeboard/schema'
import type { Editor } from '@lifeboard/canvas'
import type { BlobStore } from '../platform/PlatformAdapter'
import { missingServerAssets, uploadServerAsset } from './serverVault'

/**
 * Keeps a server board's blobs on the server: whatever its records reference (images, book files,
 * covers, quote pictures) and the server lacks is uploaded from this browser.
 *
 * Driven by the board's content rather than by each upload path, because there are several (tldraw's
 * asset store, the extension bridge, a board moved here from a local vault) and none of them knows
 * which vault the board it serves belongs to. A hash this browser doesn't have is another device's to
 * upload, so it is left unconfirmed and asked about again on the next change.
 */
export function uploadBoardAssets(editor: Editor, blobs: BlobStore): () => void {
	const confirmed = new Set<string>()
	let timer: ReturnType<typeof setTimeout> | undefined
	let running = false
	let rerun = false

	const run = async () => {
		if (running) {
			rerun = true
			return
		}
		running = true
		try {
			const store = Object.fromEntries(editor.store.allRecords().map((record) => [record.id, record]))
			const fresh = [...collectAssetRefs({ store }).hashes].filter((hash) => !confirmed.has(hash))
			if (!fresh.length) return
			const missing = new Set(await missingServerAssets(fresh))
			for (const hash of fresh) {
				if (missing.has(hash)) {
					const blob = await blobs.get(hash)
					if (!blob) continue
					await uploadServerAsset(hash, blob)
				}
				confirmed.add(hash)
			}
		} catch (error) {
			// Offline, or the server refused: the next change asks again.
			console.error('Lifeboard: could not upload this board’s files to the server.', error)
		} finally {
			running = false
			if (rerun) {
				rerun = false
				schedule()
			}
		}
	}
	// Debounced: the store fires on every frame of a drag, and this only cares once things settle.
	const schedule = () => {
		clearTimeout(timer)
		timer = setTimeout(() => void run(), 500)
	}

	const unlisten = editor.store.listen(schedule, { scope: 'document' })
	void run()
	return () => {
		unlisten()
		clearTimeout(timer)
	}
}
