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
		expect(parseServerMessage(JSON.stringify({ type: 'welcome', version: 1 }))).toEqual({
			type: 'welcome',
			version: 1,
		})
		expect(parseServerMessage(JSON.stringify({ type: 'rejected', reason: 'bad token' }))).toEqual({
			type: 'rejected',
			reason: 'bad token',
		})
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
