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
 * (images, books) and stored as they are, so memory holds one file at a time. Stars are the
 * downloading person's.
 */
export function exportVault(
	vault: Vault,
	rooms: Rooms,
	assets: AssetFiles,
	appVersion: string,
	{ vaultId, favorites }: { vaultId: string; favorites: Set<string> }
): Readable {
	const out = new PassThrough()
	const zip = new Zip((error, chunk, final) => {
		if (error) return out.destroy(error)
		out.write(chunk)
		if (final) out.end()
	})
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
				if (!assets.has(hash)) continue
				const chunks: Buffer[] = []
				for await (const chunk of assets.read(hash)) chunks.push(chunk as Buffer)
				add(`assets/${hash}`, Buffer.concat(chunks), false)
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
