import { describe, expect, it } from 'vitest'
import { AGENT_PROTOCOL_VERSION, encode, parseServerMessage } from './protocol'

/**
 * A local WebSocket is reachable by any page the browser has open, so every one of these is an input
 * the parser will actually see — not a hypothetical.
 */
describe('parseServerMessage', () => {
	it('reads an invoke', () => {
		expect(
			parseServerMessage(JSON.stringify({ type: 'invoke', id: 3, operation: 'board.list', args: {} }))
		).toEqual({ type: 'invoke', id: 3, operation: 'board.list', args: {} })
	})

	it('passes args through untouched, because only the operation knows what valid means', () => {
		const message = parseServerMessage(
			JSON.stringify({ type: 'invoke', id: 1, operation: 'x', args: { anything: [1, 2] } })
		)
		expect(message).toMatchObject({ args: { anything: [1, 2] } })
	})

	it('accepts an invoke with no args at all', () => {
		expect(parseServerMessage(JSON.stringify({ type: 'invoke', id: 1, operation: 'x' }))).toEqual({
			type: 'invoke',
			id: 1,
			operation: 'x',
			args: undefined,
		})
	})

	it('reads welcome and rejected', () => {
		// An absent `chat` reads as false, which is what lets an older relay — one that predates the
		// flag entirely — connect and simply be treated as having no agent behind it.
		expect(parseServerMessage(JSON.stringify({ type: 'welcome', version: 1 }))).toEqual({
			type: 'welcome',
			version: 1,
			chat: false,
		})
		expect(
			parseServerMessage(JSON.stringify({ type: 'welcome', version: 2, chat: true }))
		).toEqual({ type: 'welcome', version: 2, chat: true })
		expect(parseServerMessage(JSON.stringify({ type: 'rejected', reason: 'bad token' }))).toEqual({
			type: 'rejected',
			reason: 'bad token',
		})
	})

	it('reads chat events, and refuses half-built ones', () => {
		expect(
			parseServerMessage(JSON.stringify({ type: 'chat', event: { kind: 'text', text: 'hi' } }))
		).toEqual({ type: 'chat', event: { kind: 'text', text: 'hi' } })
		expect(
			parseServerMessage(
				JSON.stringify({ type: 'chat', event: { kind: 'tool', id: 't1', name: 'node_insert' } })
			)
		).toEqual({ type: 'chat', event: { kind: 'tool', id: 't1', name: 'node_insert', input: undefined } })
		expect(parseServerMessage(JSON.stringify({ type: 'chat', event: { kind: 'done' } }))).toEqual({
			type: 'chat',
			event: { kind: 'done' },
		})

		for (const event of [
			{ kind: 'text' },
			{ kind: 'tool', id: 't1' },
			{ kind: 'tool-result', id: 't1' },
			{ kind: 'nonsense' },
			'not an object',
		]) {
			expect(parseServerMessage(JSON.stringify({ type: 'chat', event })), JSON.stringify(event)).toBeNull()
		}
	})

	it('reads a context-window figure, and refuses one that is not a number', () => {
		const usage = (event: unknown) => parseServerMessage(JSON.stringify({ type: 'chat', event }))

		expect(usage({ kind: 'usage', used: 42_000, max: 200_000 })).toEqual({
			type: 'chat',
			event: { kind: 'usage', used: 42_000, max: 200_000 },
		})
		// An unknown window size is a real state — the panel shows a token count and an empty ring.
		expect(usage({ kind: 'usage', used: 42_000 })).toEqual({
			type: 'chat',
			event: { kind: 'usage', used: 42_000, max: null },
		})
		expect(usage({ kind: 'usage', used: 42_000, max: 'lots' })).toEqual({
			type: 'chat',
			event: { kind: 'usage', used: 42_000, max: null },
		})

		// A non-finite `used` has no honest rendering — it would put `NaN%` on the ring — so the frame
		// is dropped rather than clamped to something invented.
		for (const event of [
			{ kind: 'usage' },
			{ kind: 'usage', used: 'plenty' },
			{ kind: 'usage', used: Number.NaN },
			{ kind: 'usage', used: Number.POSITIVE_INFINITY },
		]) {
			expect(usage(event), JSON.stringify(event)).toBeNull()
		}
	})

	it('gives a rejection without a reason something to say', () => {
		const message = parseServerMessage(JSON.stringify({ type: 'rejected' }))
		expect(message).toMatchObject({ type: 'rejected' })
		if (message?.type !== 'rejected') return
		expect(message.reason.length).toBeGreaterThan(0)
	})

	it('returns null for anything it does not recognise', () => {
		for (const raw of [
			'not json',
			'null',
			'[]',
			'"a string"',
			JSON.stringify({ type: 'unknown' }),
			JSON.stringify({ type: 'invoke', id: 'three', operation: 'x' }),
			JSON.stringify({ type: 'invoke', id: 1 }),
			JSON.stringify({ type: 'invoke', id: 1, operation: '' }),
			JSON.stringify({ type: 'invoke', id: Number.NaN, operation: 'x' }),
		]) {
			expect(parseServerMessage(raw), raw).toBeNull()
		}
	})

	it('returns null for a non-string frame, e.g. a binary one', () => {
		expect(parseServerMessage(new ArrayBuffer(8))).toBeNull()
		expect(parseServerMessage(undefined)).toBeNull()
	})
})

describe('encode', () => {
	it('round-trips a hello', () => {
		const raw = encode({
			type: 'hello',
			version: AGENT_PROTOCOL_VERSION,
			token: 'secret',
			operations: [],
		})
		expect(JSON.parse(raw)).toEqual({
			type: 'hello',
			version: AGENT_PROTOCOL_VERSION,
			token: 'secret',
			operations: [],
		})
	})
})
