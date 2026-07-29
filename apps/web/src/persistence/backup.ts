import { unzip, zip, type Unzipped, type Zippable } from 'fflate'
import { addBoard, listBoards, newBoardId, setLastBackupAt, type BoardMeta } from '../boards/boardIndex'
import type { PlatformAdapter } from '../platform/PlatformAdapter'
import { collectAssetHashes } from './assetRefs'
import { readBoardSnapshot, waitForPersistFlush, type RawBoardSnapshot } from './tldrawLocalDb'
import { setPendingRestore } from './pendingRestore'

/**
 * Zip backup (§4.4). Layout:
 *
 *   manifest.json          { formatVersion, appVersion, exportedAt, boards: [...] }
 *   boards/<id>.json       a tldraw store snapshot — embeds its schema version, so import runs
 *                          every migration automatically
 *   assets/<hash>          the raw blob bytes, content-addressed
 *
 * Import is **restore-as-copy**: boards get fresh ids, so importing a backup into a live app adds
 * copies instead of overwriting whatever is there. Assets dedupe by hash, so re-importing the same
 * backup twice costs no extra storage.
 */
export const BACKUP_FORMAT_VERSION = 1

export interface BackupManifest {
	formatVersion: number
	appVersion: string
	exportedAt: number
	boards: BoardMeta[]
}

export interface ExportResult {
	blob: Blob
	boardCount: number
	assetCount: number
}

const MANIFEST_PATH = 'manifest.json'
const BOARD_DIR = 'boards/'
const ASSET_DIR = 'assets/'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function zipAsync(files: Zippable): Promise<Uint8Array> {
	return new Promise((resolve, reject) => {
		zip(files, { level: 6 }, (err, data) => (err ? reject(err) : resolve(data)))
	})
}

function unzipAsync(data: Uint8Array): Promise<Unzipped> {
	return new Promise((resolve, reject) => {
		unzip(data, (err, files) => (err ? reject(err) : resolve(files)))
	})
}

export async function exportBackup(
	platform: PlatformAdapter,
	appVersion: string
): Promise<ExportResult> {
	// Board snapshots are read from tldraw's database, and tldraw writes on a throttle with no flush
	// on unload — so an export fired moments after an edit would capture the board as it was before
	// that edit. Waiting out the window first is what makes "export" mean "export what I see".
	await waitForPersistFlush()

	const boards = await listBoards(platform.kv)
	const files: Zippable = {}
	const referenced = new Set<string>()
	const exportedBoards: BoardMeta[] = []

	for (const board of boards) {
		const snapshot = await readBoardSnapshot(board.id)
		// A board created but never opened has no canvas data. It still belongs in the manifest —
		// dropping it would silently lose the board on restore.
		if (snapshot) {
			files[`${BOARD_DIR}${board.id}.json`] = encoder.encode(JSON.stringify(snapshot))
			for (const hash of collectAssetHashes(snapshot)) referenced.add(hash)
		}
		exportedBoards.push(board)
	}

	for (const hash of referenced) {
		const blob = await platform.blobs.get(hash)
		if (!blob) continue
		files[`${ASSET_DIR}${hash}`] = new Uint8Array(await blob.arrayBuffer())
	}

	const manifest: BackupManifest = {
		formatVersion: BACKUP_FORMAT_VERSION,
		appVersion,
		exportedAt: Date.now(),
		boards: exportedBoards,
	}
	files[MANIFEST_PATH] = encoder.encode(JSON.stringify(manifest, null, 2))

	const zipped = await zipAsync(files)
	await setLastBackupAt(platform.kv, manifest.exportedAt)

	return {
		// `Uint8Array` from fflate may be a view over a larger buffer, so slice before wrapping.
		blob: new Blob([zipped.slice().buffer as ArrayBuffer], { type: 'application/zip' }),
		boardCount: exportedBoards.length,
		assetCount: Object.keys(files).filter((f) => f.startsWith(ASSET_DIR)).length,
	}
}

export function backupFileName(now = new Date()): string {
	const pad = (n: number) => String(n).padStart(2, '0')
	const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
	return `lifeboard-backup-${stamp}.zip`
}

export interface ImportResult {
	boardsImported: number
	assetsImported: number
	warnings: string[]
}

export async function importBackup(platform: PlatformAdapter, file: Blob): Promise<ImportResult> {
	const files = await unzipAsync(new Uint8Array(await file.arrayBuffer()))
	const warnings: string[] = []

	const manifestBytes = files[MANIFEST_PATH]
	if (!manifestBytes) throw new Error('Not a Lifeboard backup: manifest.json is missing')

	let manifest: BackupManifest
	try {
		manifest = JSON.parse(decoder.decode(manifestBytes)) as BackupManifest
	} catch {
		throw new Error('Backup manifest is corrupt')
	}
	if (manifest.formatVersion > BACKUP_FORMAT_VERSION) {
		throw new Error(
			`This backup was made by a newer version of Lifeboard (format ${manifest.formatVersion}). Update the app first.`
		)
	}

	// Assets first: a board must never be restored referencing a blob that isn't stored yet.
	// `put` is content-addressed, so this dedupes against what is already here.
	let assetsImported = 0
	for (const [path, bytes] of Object.entries(files)) {
		if (!path.startsWith(ASSET_DIR) || bytes.length === 0) continue
		const hash = path.slice(ASSET_DIR.length)
		if (!/^[0-9a-f]{64}$/.test(hash)) {
			warnings.push(`Skipped asset with unexpected name: ${hash}`)
			continue
		}
		await platform.blobs.put(hash, new Blob([bytes.slice().buffer as ArrayBuffer]))
		assetsImported++
	}

	let boardsImported = 0
	for (const board of manifest.boards ?? []) {
		const bytes = files[`${BOARD_DIR}${board.id}.json`]
		// Restore-as-copy: a fresh id means importing never overwrites an existing board, and the
		// same backup can be imported twice without collision.
		const id = newBoardId()
		const now = Date.now()
		const meta: BoardMeta = {
			id,
			name: board.name || 'Imported board',
			createdAt: board.createdAt ?? now,
			updatedAt: now,
		}

		if (bytes) {
			let snapshot: RawBoardSnapshot
			try {
				snapshot = JSON.parse(decoder.decode(bytes)) as RawBoardSnapshot
			} catch {
				warnings.push(`Skipped "${meta.name}": its canvas data is corrupt`)
				continue
			}
			// The snapshot is handed to <Tldraw snapshot=…> when the board is first opened, which is
			// what makes tldraw run its migrations on it. Writing into tldraw's own database from
			// here would bypass that.
			await setPendingRestore(platform.kv, id, snapshot)
		}

		await addBoard(platform.kv, meta)
		boardsImported++
	}

	return { boardsImported, assetsImported, warnings }
}
