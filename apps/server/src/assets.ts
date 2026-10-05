import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'

/** A SHA-256 in hex: the only file names this store will ever touch. */
const HASH = /^[0-9a-f]{64}$/

export const isAssetHash = (value: string): boolean => HASH.test(value)

/**
 * The server vault's blobs, one file per content hash — the same addressing the app uses, so a board
 * moves between vaults without its `asset:<hash>` references changing.
 */
export class AssetFiles {
	constructor(private readonly dir: string) {
		mkdirSync(dir, { recursive: true })
	}

	private path(hash: string): string {
		if (!isAssetHash(hash)) throw new Error(`Not an asset hash: ${hash}`)
		return join(this.dir, hash)
	}

	has(hash: string): boolean {
		return existsSync(this.path(hash))
	}

	/**
	 * Stores the bytes, or refuses them if they don't hash to `hash`. The check is what lets clients
	 * upload by hash at all: without it, anyone holding a session could plant different bytes under a
	 * hash another board already points at.
	 */
	put(hash: string, bytes: Buffer): boolean {
		if (createHash('sha256').update(bytes).digest('hex') !== hash) return false
		if (this.has(hash)) return true
		// Written aside and renamed, so a crash mid-write never leaves a truncated file under a real hash.
		const temp = `${this.path(hash)}.${process.pid}.tmp`
		writeFileSync(temp, bytes)
		renameSync(temp, this.path(hash))
		return true
	}

	read(hash: string) {
		return createReadStream(this.path(hash))
	}

	size(hash: string): number {
		return statSync(this.path(hash)).size
	}

	/** Every stored hash with when it was written, for GC's grace period. */
	list(): { hash: string; writtenAt: number }[] {
		return readdirSync(this.dir)
			.filter(isAssetHash)
			.map((hash) => ({ hash, writtenAt: statSync(join(this.dir, hash)).mtimeMs }))
	}

	delete(hash: string): void {
		rmSync(this.path(hash), { force: true })
	}
}
