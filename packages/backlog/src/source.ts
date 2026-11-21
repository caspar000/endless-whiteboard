import { resolveItemSource, sourceEntries, type ItemSource, type SourceChoice } from '@lifeboard/node-kit'
import { Inbox } from 'lucide-react'
import { backlogEntries, type Backlog } from './model'
import { backlogs } from './store'

export const BACKLOG_EXTENSION_ID = 'lifeboard.backlog'
export const BACKLOG_SOURCE_ID = 'backlog'

/** Every backlog that holds anything, by name. */
export function backlogChoices(all: Readonly<Record<string, Backlog>>): SourceChoice[] {
	return Object.values(all)
		.filter((b) => b.entries.length > 0)
		.map((b) => ({ id: b.backlogId, label: b.name, group: '' }))
		.sort((a, b) => a.label.localeCompare(b.label))
}

/** A backlog's items, collections opened out, for a randomizer, a ranking or another card. */
export function entriesOfBacklog(backlogId: string) {
	const backlog = backlogs.one(backlogId)
	return backlog ? backlogEntries(backlog, sourceEntries) : []
}

export const backlogSource: ItemSource = {
	id: BACKLOG_SOURCE_ID,
	label: 'Backlogs',
	icon: Inbox,
	extensionId: BACKLOG_EXTENSION_ID,
	choices: () => backlogChoices(backlogs.get()),
	entries: entriesOfBacklog,
	kind: () => ({ noun: 'items', one: 'item', creator: 'Creator', tag: '', shape: 'square' }),
	// A collection's item opens as its own source would open it (a feed's video, marked watched).
	open: (entry) => {
		const at = entry.id.indexOf('|')
		const from = at > 0 ? resolveItemSource(entry.id.slice(0, at)) : null
		if (from?.source?.open) return from.source.open({ id: entry.id.slice(at + 1), url: entry.url })
		window.open(entry.url, '_blank', 'noopener,noreferrer')
	},
}
