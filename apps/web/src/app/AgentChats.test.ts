import { describe, expect, it } from 'vitest'
import { groupChats } from './AgentChats'

/**
 * Day bucketing for the chat list.
 *
 * People look for a conversation by *when* they had it, so the buckets are the feature and the
 * boundaries are where it can quietly be wrong — a chat from 11pm last night showing under Today
 * makes the whole list untrustworthy.
 */

const NOW = new Date('2026-08-16T14:00:00').getTime()
const at = (iso: string) => new Date(iso).getTime()

const chat = (sessionId: string, iso: string) => ({
	sessionId,
	title: sessionId,
	updatedAt: at(iso),
})

describe('grouping chats by day', () => {
	it('splits today from yesterday at midnight, not 24 hours ago', () => {
		const groups = groupChats(
			[
				chat('this-morning', '2026-08-16T09:00:00'),
				// 15 hours ago, but a different calendar day — "yesterday" is what a person would call it.
				chat('last-night', '2026-08-15T23:00:00'),
			],
			NOW
		)

		expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday'])
		expect(groups[0]!.chats.map((c) => c.sessionId)).toEqual(['this-morning'])
		expect(groups[1]!.chats.map((c) => c.sessionId)).toEqual(['last-night'])
	})

	it('collects the rest of the week, then everything older', () => {
		const groups = groupChats(
			[
				chat('today', '2026-08-16T08:00:00'),
				chat('midweek', '2026-08-12T10:00:00'),
				chat('ancient', '2026-06-01T10:00:00'),
			],
			NOW
		)

		expect(groups.map((g) => g.label)).toEqual(['Today', 'Last 7 days', 'Earlier'])
	})

	it('keeps the order it was given, so the newest-first list stays newest-first', () => {
		const groups = groupChats(
			[chat('newer', '2026-08-16T12:00:00'), chat('older', '2026-08-16T09:00:00')],
			NOW
		)

		expect(groups).toHaveLength(1)
		expect(groups[0]!.chats.map((c) => c.sessionId)).toEqual(['newer', 'older'])
	})

	it('has nothing to say about an empty list', () => {
		expect(groupChats([], NOW)).toEqual([])
	})
})
