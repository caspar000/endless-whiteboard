import { MessageSquare, Plus, Trash2 } from 'lucide-react'
import type { ChatSummary } from '../agent/protocol'

/**
 * The conversation list.
 *
 * Grouped by day rather than listed flat, which is how the VS Code extension's history reads and the
 * right call for the same reason: people look for a chat by *when* they had it, not by its position
 * in a list. The titles come from Claude Code's own session store, so a chat is named by what was
 * asked in it without anyone having to name it.
 */

/** Day buckets, newest first. Anything older than a week is one pile — precision stops helping there. */
function bucketFor(updatedAt: number, now: number): string {
	const day = 24 * 60 * 60 * 1000
	const startOfToday = new Date(now).setHours(0, 0, 0, 0)
	if (updatedAt >= startOfToday) return 'Today'
	if (updatedAt >= startOfToday - day) return 'Yesterday'
	if (updatedAt >= startOfToday - 7 * day) return 'Last 7 days'
	return 'Earlier'
}

export function groupChats(
	chats: readonly ChatSummary[],
	now: number
): { label: string; chats: ChatSummary[] }[] {
	const groups: { label: string; chats: ChatSummary[] }[] = []
	for (const chat of chats) {
		const label = bucketFor(chat.updatedAt, now)
		const existing = groups.find((group) => group.label === label)
		if (existing) existing.chats.push(chat)
		else groups.push({ label, chats: [chat] })
	}
	return groups
}

export function AgentChats({
	chats,
	activeId,
	onOpen,
	onNew,
	onDelete,
}: {
	chats: readonly ChatSummary[]
	activeId: string | null
	onOpen: (sessionId: string) => void
	onNew: () => void
	onDelete: (sessionId: string) => void
}) {
	const groups = groupChats(chats, Date.now())

	return (
		<div className="lb-agent-chats">
			<button type="button" className="lb-agent-chats__new" onClick={onNew}>
				<Plus size={14} aria-hidden="true" />
				New chat
			</button>

			{chats.length === 0 ? (
				<p className="lb-agent-chats__empty">No past conversations yet.</p>
			) : (
				groups.map((group) => (
					<section key={group.label} className="lb-agent-chats__group">
						<h3 className="lb-agent-chats__label">{group.label}</h3>
						{group.chats.map((chat) => (
							// A row rather than a button, because the delete control is a real button and
							// buttons cannot nest — the same shape the tab strip uses for its close control.
							<div
								key={chat.sessionId}
								className={
									chat.sessionId === activeId
										? 'lb-agent-chats__row lb-agent-chats__row--active'
										: 'lb-agent-chats__row'
								}
							>
								<button
									type="button"
									className="lb-agent-chats__open"
									onClick={() => onOpen(chat.sessionId)}
									title={chat.title}
								>
									<MessageSquare size={13} aria-hidden="true" />
									<span className="lb-agent-chats__title">{chat.title}</span>
								</button>
								<button
									type="button"
									className="lb-agent-chats__delete"
									onClick={() => onDelete(chat.sessionId)}
									aria-label={`Delete ${chat.title}`}
									title="Delete"
								>
									<Trash2 size={12} aria-hidden="true" />
								</button>
							</div>
						))}
					</section>
				))
			)}
		</div>
	)
}
