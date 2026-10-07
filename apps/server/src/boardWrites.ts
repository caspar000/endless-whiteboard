import type { TLRecord } from '@tldraw/tlschema'
import type { BoardRole, User } from './accounts.ts'

/**
 * Who a sync connection is, for others' cursors: the account's own name, whatever the client claims.
 * Colours come from the account id, so a person keeps theirs on every board and device.
 */
export function presenceIdentity(user: User): Record<string, unknown> {
	return { userId: `user:${user.id}`, userName: user.displayName, color: colorFor(user.id) }
}

const COLORS = ['#FF802B', '#EC5E41', '#F2555A', '#F04F88', '#E34BA9', '#BD54C6', '#9D5BD2', '#7B66DC', '#02B1CC', '#11B3A3', '#39B178', '#55B467']

function colorFor(id: string): string {
	let hash = 0
	for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0
	return COLORS[Math.abs(hash) % COLORS.length]!
}

type Fields = Record<string, unknown>

/**
 * What a connection may change on a board (phase 5). Comments are everyone's to write but each
 * person's own: a thread is started, and a comment written, edited or deleted, only as yourself, and
 * nothing is deleted outright (comments and threads are deleted by marking them, so the deletion
 * syncs like any other change). Anyone who can see a thread may resolve or reopen it, and react.
 *
 * Someone a board is shared with to view may do exactly that and nothing else.
 */
export function boardWriteRule(user: User, role: BoardRole) {
	return (_id: string, before: TLRecord | null, after: TLRecord | null): boolean => {
		const was = before as Fields | null
		const now = after as Fields | null
		switch ((now ?? was)?.typeName) {
			case 'comment-thread':
				if (!now) return false
				if (!was) return now.createdBy === user.id && now.isDeleted === false
				return changedKeys(was, now).every(
					(key) =>
						key === 'resolved' ||
						(was.createdBy === user.id && (key === 'anchor' || (key === 'isDeleted' && now.isDeleted === true)))
				)
			case 'comment':
				if (!now) return false
				if (!was) return now.authorId === user.id && now.isDeleted === false
				return was.authorId === user.id && !was.isDeleted && changedKeys(was, now).every((key) => EDITABLE.has(key))
			case 'comment-reaction':
				return (now ?? was)!.userId === user.id
			default:
				return role !== 'view'
		}
	}
}

/** What the author may change about a comment: its words, when, and whether it's deleted. */
const EDITABLE = new Set(['body', 'editedAt', 'isDeleted', 'meta'])

function changedKeys(was: Fields, now: Fields): string[] {
	return [...new Set([...Object.keys(was), ...Object.keys(now)])].filter((key) => JSON.stringify(was[key]) !== JSON.stringify(now[key]))
}
