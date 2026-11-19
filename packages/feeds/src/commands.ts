import type { Command } from '@lifeboard/node-kit'
import type { Editor, TLShape } from '@lifeboard/canvas'
import { RefreshCw, Settings2 } from 'lucide-react'
import { FEED_TYPE } from './board'
import { refreshSources } from './refresh'

const GROUP = 'Feeds'

/** The one feed card selected, if exactly one is. */
function selectedFeed(editor: Editor): TLShape | null {
	const selected = editor.getSelectedShapes()
	return selected.length === 1 && selected[0]!.type === FEED_TYPE ? selected[0]! : null
}

export const feedCommands: readonly Command[] = [
	{
		id: 'feeds.manage',
		title: 'Manage feed sources',
		group: GROUP,
		icon: Settings2,
		when: (ctx) => !!ctx.editor && !!selectedFeed(ctx.editor),
		run: ({ editor }) => {
			const feed = editor && selectedFeed(editor)
			if (feed) editor.setEditingShape(feed.id)
		},
	},
	{
		id: 'feeds.refresh',
		title: 'Refresh feeds',
		group: GROUP,
		icon: RefreshCw,
		when: (ctx) => ctx.view === 'board',
		run: () => refreshSources({ force: true }),
	},
]
