import type { BoardMeta } from '../boards/boardIndex'

/**
 * The server vault, as the app sees it: the board index over REST, each board's content over its own
 * sync socket. Same origin always — in production the server serves the app, and in development
 * `vite dev` proxies `/api` to it (`LIFEBOARD_SERVER_URL`, see vite.config.ts).
 *
 * Without a server (`pnpm dev` alone, or a build opened from disk) every call here reports "no server"
 * and the app is the local-only app it always was.
 */

const SEEN_KEY = 'lifeboard:serverSeen'

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
		const body = (await response.json().catch(() => null)) as { error?: string } | null
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
}

const toMeta = (board: ServerBoard): BoardMeta => ({ ...board, vault: 'server' })

/**
 * The server's boards, or `null` when there is no server to ask. A server that is there but failing
 * throws instead: that is an error worth showing, where "no server" is just how local use works.
 */
export async function listServerBoards(): Promise<BoardMeta[] | null> {
	let status: Response
	try {
		status = await fetch('/api/status', { cache: 'no-store' })
	} catch {
		return null
	}
	const body = status.ok ? ((await status.json().catch(() => null)) as { ok?: boolean } | null) : null
	if (!body?.ok) return null
	markServerSeen()
	return ((await (await api('/boards')).json()) as ServerBoard[]).map(toMeta)
}

export async function createServerBoard(name: string, id?: string): Promise<BoardMeta> {
	const response = await api('/boards', { method: 'POST', body: JSON.stringify({ name, ...(id ? { id } : {}) }) })
	return toMeta((await response.json()) as ServerBoard)
}

export async function updateServerBoard(id: string, patch: { name?: string; favorite?: boolean }): Promise<void> {
	await api(`/boards/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
}

export async function deleteServerBoard(id: string): Promise<void> {
	await api(`/boards/${id}`, { method: 'DELETE' })
}

export function syncUri(boardId: string): string {
	const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
	return `${scheme}://${location.host}/api/sync/${boardId}`
}
