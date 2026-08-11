import type { KvStore } from '../platform/PlatformAdapter'
import type { RawBoardSnapshot } from './tldrawLocalDb'

/**
 * Holds an imported board's snapshot until the board is first opened.
 *
 * Why the indirection: import must not write into tldraw's own IndexedDB. Handing the snapshot to
 * `<Tldraw snapshot={…}>` instead means tldraw itself loads it, which is what runs the props
 * migrations for boards exported by an older app version (§4.4). Once the board has been opened,
 * tldraw's normal persistence owns the data and the pending entry is dropped.
 */
const PREFIX = 'pendingRestore:'

export async function setPendingRestore(
	kv: KvStore,
	boardId: string,
	snapshot: RawBoardSnapshot
): Promise<void> {
	await kv.set(`${PREFIX}${boardId}`, snapshot)
}

export async function takePendingRestore(
	kv: KvStore,
	boardId: string
): Promise<RawBoardSnapshot | undefined> {
	return kv.get<RawBoardSnapshot>(`${PREFIX}${boardId}`)
}

export async function clearPendingRestore(kv: KvStore, boardId: string): Promise<void> {
	await kv.delete(`${PREFIX}${boardId}`)
}
