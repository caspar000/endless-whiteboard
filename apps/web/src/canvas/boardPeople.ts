import { atom } from '@lifeboard/canvas'
import { currentAccount, type Person } from '../server/accounts'
import { serverApi } from '../server/serverVault'

/**
 * The names of everyone on the boards open here, by account id: for "made by" and "edited by"
 * (docs/fork-parity.md S6). Gathered as server boards open; a name never seen reads as "someone".
 */
const people = atom<Record<string, string>>('lifeboard:board-people', {})

export async function loadBoardPeople(boardId: string): Promise<void> {
	try {
		const response = await serverApi(`/boards/${encodeURIComponent(boardId)}/people`)
		const found = (await response.json()) as Person[]
		people.update((known) => ({ ...known, ...Object.fromEntries(found.map((person) => [person.id, person.displayName])) }))
	} catch {
		// Offline, or gone: the names already known will do.
	}
}

/** A person's name; "you" for whoever is logged in here. Reactive. */
export function personName(id: string): string {
	if (id === 'local' || currentAccount.get()?.id === id) return 'you'
	return people.get()[id] ?? 'someone'
}

/** "just now", "5 min ago", "3 h ago", "2 days ago", or the date. */
export function ago(at: number, now = Date.now()): string {
	const minutes = Math.round((now - at) / 60_000)
	if (minutes < 1) return 'just now'
	if (minutes < 60) return `${minutes} min ago`
	const hours = Math.round(minutes / 60)
	if (hours < 24) return `${hours} h ago`
	const days = Math.round(hours / 24)
	if (days < 14) return `${days} ${days === 1 ? 'day' : 'days'} ago`
	return new Date(at).toLocaleDateString()
}
