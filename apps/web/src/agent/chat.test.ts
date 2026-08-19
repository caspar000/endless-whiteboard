import { beforeEach, describe, expect, it } from 'vitest'
import {
	applyChatEvent,
	clearChat,
	getChatState,
	loadHistory,
	recordPrompt,
	setAuth,
	setChats,
} from './chat'

/**
 * The transcript's one interesting rule: a streaming block arrives twice, and the second arrival
 * wins. Deltas are a preview that may be shed under load, so a transcript built by concatenating
 * them can be missing words — the authoritative `text` has to *replace* the draft, not extend it.
 */

const rows = () => getChatState().rows

beforeEach(clearChat)

describe('streaming text', () => {
	it('opens a row on the first delta and extends it', () => {
		applyChatEvent({ kind: 'delta', text: 'Adding ' })
		applyChatEvent({ kind: 'delta', text: 'a note' })

		expect(rows()).toEqual([
			{
				kind: 'agent',
				id: expect.any(String),
				// Rows carry the turn they belong to, so a fold knows what it owns — see `transcript.ts`.
				turn: expect.any(Number),
				text: 'Adding a note',
				streaming: true,
			},
		])
	})

	it('replaces the draft with the authoritative block rather than appending to it', () => {
		applyChatEvent({ kind: 'delta', text: 'Add' })
		// The delta stream lost "ing a note"; the final block is complete.
		applyChatEvent({ kind: 'text', text: 'Adding a note.' })

		expect(rows()).toEqual([
			{
				kind: 'agent',
				id: expect.any(String),
				turn: expect.any(Number),
				text: 'Adding a note.',
				streaming: false,
			},
		])
	})

	it('takes a block that never streamed', () => {
		applyChatEvent({ kind: 'text', text: 'Done.' })
		expect(rows()).toHaveLength(1)
		expect(rows()[0]).toMatchObject({ kind: 'agent', text: 'Done.', streaming: false })
	})

	it('starts a new row after a tool call interrupts the prose', () => {
		applyChatEvent({ kind: 'delta', text: 'Looking' })
		applyChatEvent({ kind: 'text', text: 'Looking.' })
		applyChatEvent({ kind: 'tool', id: 't1', name: 'mcp__lifeboard__node_insert', input: {} })
		applyChatEvent({ kind: 'delta', text: 'Added.' })

		expect(rows().map((row) => row.kind)).toEqual(['agent', 'tool', 'agent'])
	})
})

describe('tool rows', () => {
	it('resolves the row its result names', () => {
		applyChatEvent({ kind: 'tool', id: 't1', name: 'node_insert', input: { type: 'note' } })
		applyChatEvent({ kind: 'tool-result', id: 't1', ok: true, summary: '1 node' })

		expect(rows()[0]).toMatchObject({ kind: 'tool', state: 'ok', summary: '1 node' })
	})

	/**
	 * A turn that is stopped or crashes leaves tool rows mid-flight. Left as `running` they would
	 * spin forever, telling the user work is continuing after the turn is over.
	 */
	it('settles anything still running when the turn ends', () => {
		applyChatEvent({ kind: 'tool', id: 't1', name: 'node_insert', input: {} })
		applyChatEvent({ kind: 'done' })

		expect(rows()[0]).toMatchObject({ kind: 'tool', state: 'failed' })
		expect(getChatState().busy).toBe(false)
	})
})

describe('turn lifecycle', () => {
	it('is busy between the prompt and the done', () => {
		recordPrompt('add a note')
		expect(getChatState().busy).toBe(true)

		applyChatEvent({ kind: 'done' })
		expect(getChatState().busy).toBe(false)
	})

	it('shows an error the turn ended with', () => {
		recordPrompt('add a note')
		applyChatEvent({ kind: 'done', error: 'Lost the connection.' })

		expect(rows()[1]).toMatchObject({ kind: 'error', text: 'Lost the connection.' })
	})

	/** "Thinking…" arrives once per delta, and would otherwise bury the transcript in itself. */
	it('coalesces a repeated status', () => {
		applyChatEvent({ kind: 'status', text: 'Thinking…' })
		applyChatEvent({ kind: 'status', text: 'Thinking…' })
		applyChatEvent({ kind: 'status', text: 'Searching…' })

		expect(rows().map((row) => row.kind === 'status' && row.text)).toEqual([
			'Thinking…',
			'Searching…',
		])
	})
})

describe('chats, history and auth', () => {
	/**
	 * The bug this pins: the transcript writers used to publish a fresh state object without
	 * spreading the rest, so sending a prompt silently emptied the chat list and forgot who was
	 * signed in — invisible until you opened the history panel mid-conversation.
	 */
	it('keeps the chat list and auth across a turn', () => {
		setChats([{ sessionId: 'a', title: 'Trip planning', updatedAt: 1 }], 'a')
		setAuth('ok')

		recordPrompt('add a note')
		applyChatEvent({ kind: 'text', text: 'Done.' })
		applyChatEvent({ kind: 'done' })

		expect(getChatState().chats).toHaveLength(1)
		expect(getChatState().activeId).toBe('a')
		expect(getChatState().auth).toBe('ok')
	})

	it('clearing the transcript does not forget the chat list', () => {
		setChats([{ sessionId: 'a', title: 'Trip planning', updatedAt: 1 }], 'a')
		recordPrompt('hello')
		clearChat()

		expect(getChatState().rows).toEqual([])
		expect(getChatState().chats).toHaveLength(1)
	})

	it('replays a transcript through the same events a live turn produces', () => {
		loadHistory('a', [
			{ kind: 'user', text: 'What types are there?' },
			{ kind: 'text', text: 'Four.' },
			{ kind: 'tool', id: 't1', name: 'node_types', input: {} },
			{ kind: 'tool-result', id: 't1', ok: true, summary: '4 types' },
		])

		const rows = getChatState().rows
		expect(rows.map((row) => row.kind)).toEqual(['user', 'agent', 'tool'])
		// The result folded into its tool row rather than adding one, exactly as it does live.
		expect(rows[2]).toMatchObject({ kind: 'tool', state: 'ok', summary: '4 types' })
		expect(getChatState().activeId).toBe('a')
	})

	it('replacing history drops the previous conversation entirely', () => {
		loadHistory('a', [{ kind: 'user', text: 'first' }])
		loadHistory('b', [{ kind: 'user', text: 'second' }])

		expect(getChatState().rows).toHaveLength(1)
		expect(getChatState().activeId).toBe('b')
	})

	/** Signed-out is what swaps the composer for the sign-in view, so it has to survive a turn. */
	it('carries the reason a sign-in is needed', () => {
		setAuth('signed-out', 'That account is not allowed.')
		expect(getChatState().auth).toBe('signed-out')
		expect(getChatState().authDetail).toBe('That account is not allowed.')
	})
})

describe('pasted images', () => {
	const image = { mediaType: 'image/png', data: 'aGVsbG8=' }

	it('attaches them to the user row that was sent', () => {
		recordPrompt('what is this?', [image])
		expect(rows()[0]).toMatchObject({ kind: 'user', text: 'what is this?', images: [image] })
	})

	it('leaves a text-only turn without an images field', () => {
		recordPrompt('hello')
		expect(rows()[0]).not.toHaveProperty('images')
	})

	/** A screenshot with no words is a real question; the row still has to render. */
	it('keeps a row with images and no text', () => {
		recordPrompt('', [image])
		expect(rows()[0]).toMatchObject({ kind: 'user', text: '', images: [image] })
	})

	it('replays them out of history', () => {
		loadHistory('a', [{ kind: 'user', text: 'look', images: [image] }])
		expect(rows()[0]).toMatchObject({ kind: 'user', images: [image] })
	})
})
