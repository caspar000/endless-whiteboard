import { describe, expect, it } from 'vitest'
import { PromptQueue } from './session.js'

/**
 * The open input channel, which is what makes mid-turn steering possible.
 *
 * Its failure modes are both silent: a message delivered twice makes the agent answer the same
 * question again, and one dropped makes a user's follow-up simply never happen. Neither throws, so
 * both are pinned here.
 */

const message = (text: string) =>
	({
		type: 'user' as const,
		parent_tool_use_id: null,
		message: { role: 'user' as const, content: [{ type: 'text' as const, text }] },
	})

/** Reads `count` messages, then stops — the stream never ends on its own. */
async function take(stream: AsyncIterable<{ message: { content: unknown } }>, count: number) {
	const seen: string[] = []
	for await (const item of stream) {
		const [block] = item.message.content as [{ text: string }]
		seen.push(block.text)
		if (seen.length === count) break
	}
	return seen
}

describe('the prompt queue', () => {
	it('delivers messages pushed before anything is reading', async () => {
		const queue = new PromptQueue()
		queue.push(message('first'))
		queue.push(message('second'))

		await expect(take(queue.stream(), 2)).resolves.toEqual(['first', 'second'])
	})

	/** The steering case: the reader is already waiting when the follow-up arrives. */
	it('hands a message straight to a waiting reader', async () => {
		const queue = new PromptQueue()
		const reading = take(queue.stream(), 1)

		// Pushed after the read started, which is what a mid-turn message is.
		await Promise.resolve()
		queue.push(message('steer'))

		await expect(reading).resolves.toEqual(['steer'])
	})

	it('delivers each message exactly once', async () => {
		const queue = new PromptQueue()
		const reading = take(queue.stream(), 3)

		await Promise.resolve()
		queue.push(message('a'))
		queue.push(message('b'))
		queue.push(message('c'))

		await expect(reading).resolves.toEqual(['a', 'b', 'c'])
	})

	/** `isEmpty` is what decides a `result` means genuinely idle rather than one turn of several. */
	it('reports emptiness so idle can be told from mid-queue', async () => {
		const queue = new PromptQueue()
		expect(queue.isEmpty()).toBe(true)

		queue.push(message('queued'))
		expect(queue.isEmpty()).toBe(false)

		await take(queue.stream(), 1)
		expect(queue.isEmpty()).toBe(true)
	})

	it('ends the stream when closed, so a switched chat does not hang', async () => {
		const queue = new PromptQueue()
		const drained = (async () => {
			const seen = []
			for await (const item of queue.stream()) seen.push(item)
			return seen
		})()

		await Promise.resolve()
		queue.close()

		await expect(drained).resolves.toEqual([])
	})

	it('ignores anything pushed after closing', async () => {
		const queue = new PromptQueue()
		queue.close()
		queue.push(message('too late'))
		expect(queue.isEmpty()).toBe(true)
	})
})
