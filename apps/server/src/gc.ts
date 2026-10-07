import { collectAssetRefs } from '@lifeboard/schema'
import type { FastifyBaseLogger } from 'fastify'
import type { AssetFiles } from './assets.ts'
import type { Rooms } from './rooms.ts'
import type { Vault } from './vault.ts'

/** A day: long enough for an upload that lands before the record pointing at it. */
const GRACE_MS = 24 * 60 * 60 * 1000

export type GcResult = { deleted: number } | { skipped: string }

/**
 * Mark-and-sweep over the vault's asset files, with the app's rule (`boards/deleteBoard.ts`): when in
 * doubt, keep the file. A board that can't be read, or an asset record still waiting for its upload,
 * means we can't say what is referenced, so nothing is swept that day. And nothing younger than a day
 * is swept at all, because a client uploads before the record that points at it reaches the room.
 */
export function collectGarbage(vault: Vault, rooms: Rooms, assets: AssetFiles, now = Date.now()): GcResult {
	const referenced = new Set<string>()
	for (const board of vault.all()) {
		let snapshot
		try {
			snapshot = rooms.readSnapshot(board.id)
		} catch (error) {
			return { skipped: `board ${board.id} could not be read: ${String(error)}` }
		}
		if (!snapshot) continue
		const refs = collectAssetRefs(snapshot)
		if (refs.pending) return { skipped: `board ${board.id} has an image still uploading` }
		for (const hash of refs.hashes) referenced.add(hash)
	}

	let deleted = 0
	for (const { hash, writtenAt } of assets.list()) {
		if (referenced.has(hash) || now - writtenAt < GRACE_MS) continue
		assets.delete(hash)
		deleted++
	}
	return { deleted }
}

/** Once at startup and then daily. `unref`, so a pending sweep never keeps the process alive. */
export function scheduleGarbageCollection(run: () => GcResult, log: FastifyBaseLogger): () => void {
	const sweep = () => {
		const result = run()
		if ('skipped' in result) log.warn(`Asset GC skipped: ${result.skipped}`)
		else if (result.deleted) log.info(`Asset GC deleted ${result.deleted} unreferenced file(s).`)
	}
	const first = setTimeout(sweep, 60_000).unref()
	const daily = setInterval(sweep, GRACE_MS).unref()
	return () => {
		clearTimeout(first)
		clearInterval(daily)
	}
}
