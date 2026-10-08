import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import type { BlobStore, KvStore, PlatformAdapter } from '../platform/PlatformAdapter'
import { importBackup } from './backup'
import { getImportProgress, importDetail, importShare, subscribeToImportProgress, type ImportProgress } from './importProgress'

const kv = (): KvStore => {
	const store = new Map<string, unknown>()
	return {
		get: async <T,>(key: string) => store.get(key) as T | undefined,
		set: async <T,>(key: string, value: T) => void store.set(key, value),
		delete: async (key: string) => void store.delete(key),
		keys: async () => [...store.keys()],
	}
}
const blobs = (): BlobStore => {
	const store = new Map<string, Blob>()
	return {
		get: async (hash) => store.get(hash),
		put: async (hash, blob) => void store.set(hash, blob),
		has: async (hash) => store.has(hash),
		delete: async (hash) => void store.delete(hash),
		list: async () => [...store.keys()],
		size: async () => 0,
	}
}

describe('importing a backup', () => {
	it('says what stage it is at as it goes, and nothing once it is done', async () => {
		const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
		const files: Record<string, Uint8Array> = {
			'manifest.json': encode({ formatVersion: 1, appVersion: 'test', exportedAt: 0, boards: [{ id: 'b1', name: 'One', createdAt: 1, updatedAt: 1 }] }),
			'boards/b1.json': encode({ store: {}, schema: {} }),
		}
		for (let i = 0; i < 45; i++) files[`assets/${i.toString(16).padStart(64, '0')}`] = new Uint8Array([i])
		const zipped = zipSync(files)

		const seen: ImportProgress[] = []
		const stop = subscribeToImportProgress(() => {
			const progress = getImportProgress()
			if (progress) seen.push(progress)
		})
		const platform = { kv: kv(), blobs: blobs() } as unknown as PlatformAdapter
		const result = await importBackup(platform, new Blob([zipped]))
		stop()

		expect(result).toMatchObject({ boardsImported: 1, assetsImported: 45 })
		expect(seen.map((p) => p.stage)).toEqual(['reading', 'files', 'files', 'files', 'boards'])
		expect(seen.map(importDetail)).toContain('Files 40 of 45')
		expect(seen.map(importShare)).toEqual([...seen.map(importShare)].sort((a, b) => a - b))
		expect(getImportProgress()).toBeNull()
	})

	it('reads big backups in gigabytes', () => {
		expect(importDetail({ stage: 'reading', bytes: 1.3 * 1024 ** 3 })).toBe('Reading 1.3 GB')
	})
})
