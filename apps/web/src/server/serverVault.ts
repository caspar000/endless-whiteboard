import { clearSyncCache, listSyncCacheRooms } from '@lifeboard/canvas-sync'
import type { BoardMeta } from '../boards/boardIndex'
import type { ResolvedTheme } from '../app/useTheme'
import type { KvStore } from '../platform/PlatformAdapter'

/**
 * The server vault, as the app sees it: the board index over REST, each board's content over its own
 * sync socket. Same origin always — in production the server serves the app, and in development
 * `vite dev` proxies `/api` to it (`LIFEBOARD_SERVER_URL`, see vite.config.ts).
 *
 * Without a server (`pnpm dev` alone, or a build opened from disk) every call here reports "no server"
 * and the app is the local-only app it always was.
 */

const SEEN_KEY = 'lifeboard:serverSeen'

/** Whether the server answered in this session; vault settings are only pushed while it does. */
let available = false

/**
 * Whether this browser has ever had a server vault. Remembered rather than checked live, because the
 * question is asked by local asset GC (`boards/deleteBoard.ts`): server boards keep their images in
 * this browser's blob store until assets sync, and an offline session must not sweep them.
 */
export function hasEverHadServer(): boolean {
	try {
		return localStorage.getItem(SEEN_KEY) === '1'
	} catch {
		// Can't tell, so assume the worst: skipping a sweep costs disk, a wrong sweep costs photos.
		return true
	}
}

function markServerSeen(): void {
	try {
		localStorage.setItem(SEEN_KEY, '1')
	} catch {
		// Private-mode Safari; `hasEverHadServer` already answers true when storage throws.
	}
}

/** A request to the server's API, for the other server modules (`accounts.ts`). Throws on failure. */
export const serverApi = (path: string, init?: RequestInit) => api(path, init)

async function api(path: string, init?: RequestInit): Promise<Response> {
	const response = await fetch(`/api${path}`, {
		...init,
		headers: { ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers },
		cache: 'no-store',
	})
	if (response.status === 401) {
		// The session ran out while the service worker kept serving the app from its cache. The login
		// page sends us back here.
		window.location.assign(`/login?next=${encodeURIComponent(location.pathname + location.hash)}`)
		throw new Error('Not logged in.')
	}
	if (!response.ok) {
		const body = (await response.json().catch(() => null)) as { error?: string; choosePassword?: boolean } | null
		if (body?.choosePassword) {
			// Someone else set this account's password: the server wants a new one before anything else.
			window.location.assign(`/password?next=${encodeURIComponent(location.pathname + location.hash)}`)
		}
		throw new Error(body?.error ?? `The server answered ${response.status}.`)
	}
	return response
}

interface ServerBoard {
	id: string
	name: string
	createdAt: number
	updatedAt: number
	favorite: boolean
	/** In this account's vault, or shared with it from another to edit or to view. */
	role: 'member' | 'edit' | 'view'
	/** The vault a shared board is from. */
	sharedBy?: string
}

const toMeta = (board: ServerBoard): BoardMeta => ({ ...board, vault: 'server' })

/** The server's board list as last seen, for opening its boards offline (docs/fork-parity.md S5). */
const LIST_KEY = 'serverBoards'

/** Forgets that list: logging out. */
export const forgetServerBoardList = (kv: KvStore) => kv.delete(LIST_KEY)

/**
 * The server's boards: from the server (`online`), or as this device last saw them when it can't be
 * reached (each one opens from its copy here, see `canvas/Board.tsx`). `null` when this browser has
 * never had a server: that is just how local use works. A server that answers and then fails throws
 * instead, an error worth showing.
 */
export async function listServerBoards(kv: KvStore): Promise<{ boards: BoardMeta[]; online: boolean } | null> {
	const offline = async () => {
		available = false
		if (!hasEverHadServer()) return null
		const boards = await kv.get<BoardMeta[]>(LIST_KEY).catch(() => undefined)
		return boards ? { boards, online: false } : null
	}
	let status: Response
	try {
		status = await fetch('/api/status', { cache: 'no-store' })
	} catch {
		return offline()
	}
	const body = status.ok ? ((await status.json().catch(() => null)) as { ok?: boolean } | null) : null
	if (!body?.ok) return offline()
	available = true
	markServerSeen()
	const boards = ((await (await api('/boards')).json()) as ServerBoard[]).map(toMeta)
	await kv.set(LIST_KEY, boards)
	void forgetBoardsNotOn(boards)
	return { boards, online: true }
}

/**
 * Drops this device's copies of boards the server no longer has: deleted on another device, or moved
 * to one. Nothing else would ever clear them.
 */
async function forgetBoardsNotOn(boards: BoardMeta[]): Promise<void> {
	const kept = new Set(boards.map((board) => board.id))
	try {
		for (const room of await listSyncCacheRooms()) if (!kept.has(room)) await clearSyncCache(room)
	} catch (error) {
		console.error('Lifeboard: could not tidy the boards kept on this device.', error)
	}
}

/**
 * A new server board — empty, or (moving from this device) with its id, star, content and dates, so it
 * keeps its place in the list.
 */
export async function createServerBoard(
	name: string,
	id?: string,
	moved?: { snapshot: unknown; favorite: boolean; createdAt: number; updatedAt: number }
): Promise<BoardMeta> {
	const response = await api('/boards', {
		method: 'POST',
		body: JSON.stringify({ name, ...(id ? { id } : {}), ...moved }),
	})
	return toMeta((await response.json()) as ServerBoard)
}

/** A server board's content as it is now, in the shape local boards and backups use. */
export async function readServerBoard(id: string): Promise<{ store: Record<string, unknown>; schema: unknown }> {
	return (await api(`/boards/${id}/snapshot`)).json() as Promise<{ store: Record<string, unknown>; schema: unknown }>
}

export async function updateServerBoard(id: string, patch: { name?: string; favorite?: boolean }): Promise<void> {
	await api(`/boards/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
}

export async function deleteServerBoard(id: string): Promise<void> {
	await api(`/boards/${id}`, { method: 'DELETE' })
	await clearSyncCache(id).catch(() => {})
}

/** Whether the server has this board: how an interrupted move tells which step it reached. */
export async function serverHasBoard(id: string): Promise<boolean> {
	return ((await (await api('/boards')).json()) as ServerBoard[]).some((board) => board.id === id)
}

/**
 * A server board's preview in one theme, as whichever device last drew one sent it, and when, by the
 * server's clock (compare with the board's `updatedAt`); `null` if none has.
 */
export async function fetchServerThumbnail(
	id: string,
	theme: ResolvedTheme
): Promise<{ blob: Blob; drawnAt: number } | null> {
	try {
		const response = await fetch(`/api/boards/${id}/thumbnail/${theme}`, { cache: 'no-store' })
		if (!response.ok) return null
		return { blob: await response.blob(), drawnAt: Number(response.headers.get('x-drawn-at')) || 0 }
	} catch {
		return null
	}
}

/** Sends a server board's preview, so every device shows it. Best effort: a preview is decoration. */
export async function uploadServerThumbnail(id: string, theme: ResolvedTheme, blob: Blob): Promise<void> {
	if (blob.type !== 'image/webp') return
	await fetch(`/api/boards/${id}/thumbnail/${theme}`, {
		method: 'PUT',
		headers: { 'content-type': 'image/webp' },
		body: blob,
	}).catch(() => {})
}

/** Settings that follow the vault rather than the device. See `app/vaultSettings.ts`. */
export type VaultSettingKey = 'savedQueries' | 'disabledExtensions'

export async function getVaultSettings(): Promise<Partial<Record<VaultSettingKey, unknown>>> {
	return (await (await api('/vault/settings')).json()) as Partial<Record<VaultSettingKey, unknown>>
}

/** Fire and forget: the local copy is already saved, so a failed push costs only the other devices. */
export function pushVaultSetting(key: VaultSettingKey, value: unknown): void {
	if (!available) return
	void api(`/vault/settings/${key}`, { method: 'PUT', body: JSON.stringify({ value }) }).catch((error) =>
		console.error(`Lifeboard: could not save ${key} to the server.`, error)
	)
}

const downloads = new Map<string, Promise<Blob | null>>()

/**
 * Retries a 404 a few times: the record pointing at a blob reaches other devices through the sync
 * room before the device that added it has finished uploading the bytes.
 */
async function download(hash: string): Promise<Blob | null> {
	for (const wait of [0, 1000, 2000, 4000]) {
		if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
		try {
			const response = await fetch(`/api/assets/${hash}`)
			if (response.ok) return await response.blob()
			if (response.status !== 404) return null
		} catch {
			return null
		}
	}
	return null
}

/**
 * A blob this browser doesn't have, from the server vault — or `null` without a server, or if it lacks
 * it too. One request per hash however many shapes ask at once.
 */
export function fetchServerAsset(hash: string): Promise<Blob | null> {
	if (!available) return Promise.resolve(null)
	let pending = downloads.get(hash)
	if (!pending) {
		pending = download(hash).finally(() => downloads.delete(hash))
		downloads.set(hash, pending)
	}
	return pending
}

/** Of these hashes, the ones the server has no file for. */
export async function missingServerAssets(hashes: string[]): Promise<string[]> {
	const response = await api('/assets/missing', { method: 'POST', body: JSON.stringify({ hashes }) })
	return ((await response.json()) as { missing: string[] }).missing
}

/**
 * Sends a file. `false` when the server refuses it because its bytes don't hash to the name it is
 * stored under: a damaged file, which no device could load by that name anyway.
 */
export async function uploadServerAsset(hash: string, blob: Blob): Promise<boolean> {
	try {
		await api(`/assets/${hash}`, { method: 'PUT', body: blob, headers: { 'content-type': 'application/octet-stream' } })
		return true
	} catch (error) {
		if (error instanceof Error && /do not match/.test(error.message)) return false
		throw error
	}
}

/**
 * Starts the download of every board in this account's vault and the files they use, in the app's own
 * backup format (importable as copies).
 *
 * A download the browser runs itself, not a fetch: a vault with its pictures and books is hundreds of
 * megabytes, which a fetch would hold in the page, with no progress, until the last byte, and lose to
 * a reload. The browser's own shows progress, writes to disk as it goes, and outlives the page.
 *
 * The session is checked first, so an expired one goes to the login page rather than downloading an
 * error as the backup.
 */
export async function startServerBackupDownload(): Promise<void> {
	await api('/me')
	const anchor = document.createElement('a')
	anchor.href = '/api/export'
	anchor.download = ''
	anchor.rel = 'noopener'
	document.body.append(anchor)
	anchor.click()
	anchor.remove()
}

export function syncUri(boardId: string): string {
	const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
	return `${scheme}://${location.host}/api/sync/${boardId}`
}
