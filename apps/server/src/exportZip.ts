import { once } from 'node:events'
import { PassThrough, type Readable } from 'node:stream'
import { collectAssetRefs } from '@lifeboard/schema'
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate'
import type { AssetFiles } from './assets.ts'
import type { Rooms } from './rooms.ts'
import type { Vault } from './vault.ts'

/** The app's backup format (`apps/web/src/persistence/backup.ts`), so the app can import it as is. */
const BACKUP_FORMAT_VERSION = 1

const encoder = new TextEncoder()

/**
 * One vault as one zip, streamed: boards are small and compressed, assets are already compressed
 * (images, books) and stored as they are. Files are read a piece at a time and the zip is written only
 * as fast as the download takes it, so memory holds a piece, not the vault, however slow the
 * connection. A download that stops stops the zip. Stars are the downloading person's.
 */
export function exportVault(
	vault: Vault,
	rooms: Rooms,
	assets: AssetFiles,
	appVersion: string,
	{ vaultId, favorites }: { vaultId: string; favorites: Set<string> }
): Readable {
	const out = new PassThrough()
	// Whether the download has fallen behind: the next piece waits until it catches up.
	let behind = false
	const zip = new Zip((error, chunk, final) => {
		if (error) return out.destroy(error)
		if (!out.write(chunk)) behind = true
		if (final) out.end()
	})
	const keepPace = async () => {
		if (!behind || out.destroyed) return
		behind = false
		await Promise.race([once(out, 'drain'), once(out, 'close')])
	}
	const add = (name: string, bytes: Uint8Array, compress: boolean) => {
		const file = compress ? new ZipDeflate(name, { level: 6 }) : new ZipPassThrough(name)
		zip.add(file)
		file.push(bytes, true)
	}

	void (async () => {
		try {
			const boards = vault.list(vaultId).map(({ id, name, createdAt, updatedAt }) => ({
				id,
				name,
				createdAt,
				updatedAt,
				favorite: favorites.has(id),
			}))
			const referenced = new Set<string>()
			for (const board of boards) {
				const snapshot = rooms.readSnapshot(board.id)
				if (!snapshot) continue
				add(`boards/${board.id}.json`, encoder.encode(JSON.stringify(snapshot)), true)
				for (const hash of collectAssetRefs(snapshot).hashes) referenced.add(hash)
			}
			for (const hash of referenced) {
				if (out.destroyed) return
				if (!assets.has(hash)) continue
				const file = new ZipPassThrough(`assets/${hash}`)
				zip.add(file)
				for await (const chunk of assets.read(hash)) {
					file.push(chunk as Buffer)
					await keepPace()
					if (out.destroyed) return
				}
				file.push(new Uint8Array(0), true)
			}
			const manifest = { formatVersion: BACKUP_FORMAT_VERSION, appVersion, exportedAt: Date.now(), boards }
			add('manifest.json', encoder.encode(JSON.stringify(manifest, null, 2)), true)
			zip.end()
		} catch (error) {
			out.destroy(error as Error)
		}
	})()

	return out
}
