import { clearSyncCache, listSyncCacheRooms } from '@lifeboard/canvas-sync'
import type { KvStore } from '../platform/PlatformAdapter'
import { forgetServerBoardList, serverApi } from './serverVault'

/**
 * The account side of the server vault (apps/server/src/accounts.ts): who is logged in, their vault and
 * its members, the invites they've made, and the links a board is shared through.
 */

export interface Me {
	id: string
	username: string
	displayName: string
	isAdmin: boolean
	vault: { id: string; name: string }
}

export interface Person {
	id: string
	username: string
	displayName: string
}

export interface Invite {
	token: string
	kind: 'join' | 'new-vault'
	createdAt: number
	expiresAt: number
}

export type ShareRole = 'view' | 'edit'

export interface ShareLink {
	id: string
	token: string
	role: ShareRole
	createdAt: number
}

export interface SharedPerson extends Person {
	role: ShareRole
	addedAt: number
}

const json = async <T>(response: Response) => (await response.json()) as T
const body = (value: unknown): RequestInit => ({ body: JSON.stringify(value) })

export const getMe = async () => json<Me>(await serverApi('/me'))

export const updateMe = async (patch: { username?: string; displayName?: string }) =>
	json<Person>(await serverApi('/me', { method: 'PATCH', ...body(patch) }))

export async function changePassword(current: string, next: string): Promise<void> {
	await serverApi('/me/password', { method: 'POST', ...body({ current, next }) })
}

export const getVault = async () => json<{ id: string; name: string; members: Person[] }>(await serverApi('/vault'))

export async function renameVault(name: string): Promise<void> {
	await serverApi('/vault', { method: 'PATCH', ...body({ name }) })
}

export const listInvites = async () => json<Invite[]>(await serverApi('/invites'))

export const createInvite = async (kind: Invite['kind']) =>
	json<Invite>(await serverApi('/invites', { method: 'POST', ...body({ kind }) }))

export async function withdrawInvite(token: string): Promise<void> {
	await serverApi(`/invites/${encodeURIComponent(token)}`, { method: 'DELETE' })
}

export const inviteUrl = (token: string) => `${location.origin}/invite/${token}`
export const shareUrl = (token: string) => `${location.origin}/share/${token}`

export const getShares = async (boardId: string) =>
	json<{ links: ShareLink[]; people: SharedPerson[] }>(await serverApi(`/boards/${encodeURIComponent(boardId)}/shares`))

export const createShare = async (boardId: string, role: ShareRole) =>
	json<ShareLink>(await serverApi(`/boards/${encodeURIComponent(boardId)}/shares`, { method: 'POST', ...body({ role }) }))

export async function revokeShare(shareId: string): Promise<void> {
	await serverApi(`/shares/${encodeURIComponent(shareId)}`, { method: 'DELETE' })
}

/** Takes someone off a shared board; `'me'` leaves a board shared with you. */
export async function removeBoardAccess(boardId: string, userId: string | 'me'): Promise<void> {
	await serverApi(`/boards/${encodeURIComponent(boardId)}/access/${encodeURIComponent(userId)}`, { method: 'DELETE' })
	if (userId === 'me') await clearSyncCache(boardId).catch(() => {})
}

/**
 * Logs out, and leaves nothing of the account's boards on this device: the copies kept for offline
 * use, and the remembered board list. The next person to use this browser starts clean.
 */
export async function logOut(kv: KvStore): Promise<void> {
	try {
		for (const room of await listSyncCacheRooms()) await clearSyncCache(room)
		await forgetServerBoardList(kv)
	} finally {
		await fetch('/logout', { method: 'POST' }).catch(() => {})
		location.assign('/login')
	}
}
