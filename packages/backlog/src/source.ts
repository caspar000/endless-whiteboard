import { resolveItemSource, sourceEntries, sourceKey, watchSourceKeys, type ItemSource, type SourceChoice } from '@lifeboard/node-kit'
import { Inbox } from 'lucide-react'
import { backlogEntries, type Backlog } from './model'
import { backlogs } from './store'

export const BACKLOG_EXTENSION_ID = 'lifeboard.backlog'
export const BACKLOG_SOURCE_ID = 'backlog'

/** Every backlog on a board that holds anything, by name (DARK-14: never another board's). */
export function backlogChoices(all: Readonly<Record<string, Backlog>>, boardId: string): SourceChoice[] {
	return Object.values(all)
		.filter((b) => b.entries.length > 0 && b.boardId === boardId)
		.map((b) => ({ id: b.backlogId, label: b.name, group: '' }))
		.sort((a, b) => a.label.localeCompare(b.label))
}

/** A backlog's items, collections opened out, for a randomizer, a ranking or another card. */
export function entriesOfBacklog(backlogId: string) {
	const backlog = backlogs.one(backlogId)
	return backlog ? backlogEntries(backlog, sourceEntries) : []
}

/**
 * Keeps a backlog's collections fresh while it is shown or read (a feed in it reads its channels), as
 * their own cards would: those added later too, and not those taken out.
 */
export function watchBacklog(backlogId: string): () => void {
	return watchSourceKeys(sourceKey(BACKLOG_SOURCE_ID, backlogId), () =>
		(backlogs.one(backlogId)?.entries ?? []).filter((e) => e.kind === 'collection').map((e) => e.id)
	)
}

export const backlogSource: ItemSource = {
	id: BACKLOG_SOURCE_ID,
	label: 'Backlogs',
	icon: Inbox,
	extensionId: BACKLOG_EXTENSION_ID,
	choices: (boardId) => backlogChoices(backlogs.get(), boardId),
	choice: (backlogId) => {
		const backlog = backlogs.one(backlogId)
		return backlog ? { id: backlogId, label: backlog.name, group: '' } : null
	},
	entries: entriesOfBacklog,
	kind: () => ({ noun: 'items', one: 'item', creator: 'Creator', tag: '', shape: 'square' }),
	watch: watchBacklog,
	// A collection's item opens as its own source would open it (a feed's video, marked watched).
	open: (entry) => {
		const at = entry.id.indexOf('|')
		const from = at > 0 ? resolveItemSource(entry.id.slice(0, at)) : null
		if (from?.source?.open) return from.source.open({ id: entry.id.slice(at + 1), url: entry.url })
		window.open(entry.url, '_blank', 'noopener,noreferrer')
	},
}
