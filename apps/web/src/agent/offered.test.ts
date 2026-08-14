import {
	clearOperationRegistry,
	defineOperation,
	ok,
	registerOperation,
} from '@lifeboard/node-kit'
import { beforeEach, describe, expect, it } from 'vitest'
import { offeredOperations } from './bridge'

beforeEach(() => {
	clearOperationRegistry()
	registerOperation(
		defineOperation({
			id: 'test.read',
			title: 'Read',
			description: 'Reads the board.',
			readOnly: true,
			params: {},
			run: async () => ok(null),
		})
	)
	registerOperation(
		defineOperation({
			id: 'test.write',
			title: 'Write',
			description: 'Changes the board.',
			params: {},
			run: async () => ok(null),
		})
	)
})

describe('offeredOperations', () => {
	it('offers everything when not read-only', () => {
		expect(offeredOperations(false).map((op) => op.id)).toEqual(['test.read', 'test.write'])
	})

	it('withholds the mutating ones in read-only mode', () => {
		expect(offeredOperations(true).map((op) => op.id)).toEqual(['test.read'])
	})

	it('treats an operation that never declared itself read-only as mutating', () => {
		// The safe default, and the reason `readOnly` is optional-but-false rather than optional-but-
		// unknown: an operation added later that forgets to say is withheld, not quietly allowed.
		registerOperation(
			defineOperation({
				id: 'test.unspecified',
				title: 'Unspecified',
				description: 'Says nothing about whether it writes.',
				params: {},
				run: async () => ok(null),
			})
		)
		expect(offeredOperations(true).map((op) => op.id)).not.toContain('test.unspecified')
	})
})
