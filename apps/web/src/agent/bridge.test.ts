import {
	clearBoardBridge,
	clearOperationRegistry,
	defineOperation,
	ok,
	registerOperation,
	setBoardBridge,
	type BoardBridge,
} from '@lifeboard/node-kit'
import type { Editor } from 'tldraw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleServerMessage, type BridgeDeps } from './bridge'
import type { ClientMessage } from './protocol'

function boardBridge(): BoardBridge {
	return {
		list: async () => [],
		create: async (name: string) => ({ id: 'b', name, createdAt: 0, updatedAt: 0 }),
		rename: async () => {},
		remove: async () => {},
		open: async () => null,
		editorFor: () => null,
	}
}

function deps(over: Partial<BridgeDeps> = {}) {
	const sent: ClientMessage[] = []
	const full: BridgeDeps = {
		send: (message) => sent.push(message),
		activeEditor: () => null,
		onRejected: vi.fn(),
		readOnly: false,
		...over,
	}
	return { deps: full, sent }
}

const frame = (message: object) => JSON.stringify(message)

beforeEach(() => {
	clearOperationRegistry()
	clearBoardBridge()
})

describe('handleServerMessage', () => {
	it('runs the operation and answers with its result', async () => {
		setBoardBridge(boardBridge())
		registerOperation(
			defineOperation({
				id: 'test.echo',
				title: 'Echo',
				description: 'Returns what it was given.',
				params: { word: { type: 'string', description: 'A word', required: true } },
				run: async (_ctx, args) => ok({ echoed: args.word }),
			})
		)

		const { deps: d, sent } = deps()
		await handleServerMessage(
			frame({ type: 'invoke', id: 7, operation: 'test.echo', args: { word: 'hi' } }),
			d
		)

		expect(sent).toEqual([
			{ type: 'result', id: 7, result: { ok: true, data: { echoed: 'hi' } } },
		])
	})

	it('answers an unknown operation rather than leaving the agent hanging', async () => {
		setBoardBridge(boardBridge())
		const { deps: d, sent } = deps()
		await handleServerMessage(frame({ type: 'invoke', id: 1, operation: 'test.nope' }), d)

		expect(sent).toHaveLength(1)
		expect(sent[0]).toMatchObject({ type: 'result', id: 1, result: { ok: false } })
	})

	it('answers a validation failure, still with the matching id', async () => {
		setBoardBridge(boardBridge())
		registerOperation(
			defineOperation({
				id: 'test.needs',
				title: 'Needs',
				description: 'Requires a word.',
				params: { word: { type: 'string', description: 'A word', required: true } },
				run: async () => ok(null),
			})
		)

		const { deps: d, sent } = deps()
		await handleServerMessage(frame({ type: 'invoke', id: 42, operation: 'test.needs', args: {} }), d)

		const [reply] = sent
		expect(reply).toMatchObject({ type: 'result', id: 42 })
		if (reply?.type !== 'result' || reply.result.ok) throw new Error('expected a failure')
		expect(reply.result.error).toContain('word')
	})

	it('answers even with no board bridge installed, so a call never hangs', async () => {
		// The app is still starting up: `createOperationContext` returns null and there is nothing to
		// run against — but the agent is owed a reply either way.
		const { deps: d, sent } = deps()
		await handleServerMessage(frame({ type: 'invoke', id: 2, operation: 'anything' }), d)

		expect(sent).toHaveLength(1)
		expect(sent[0]).toMatchObject({ result: { ok: false } })
	})

	it('passes the active board to the operation, read at invoke time', async () => {
		setBoardBridge(boardBridge())
		const editor = { marker: true } as unknown as Editor
		let seen: Editor | null = null
		registerOperation(
			defineOperation({
				id: 'test.peek',
				title: 'Peek',
				description: 'Reports which editor it saw.',
				params: {},
				run: async (ctx) => {
					seen = ctx.editor
					return ok(null)
				},
			})
		)

		let active: Editor | null = null
		const { deps: d } = deps({ activeEditor: () => active })
		// Changed *after* the deps were built — a bridge that captured the editor would fail here.
		active = editor

		await handleServerMessage(frame({ type: 'invoke', id: 1, operation: 'test.peek' }), d)
		expect(seen).toBe(editor)
	})

	it('refuses a mutating operation in read-only mode, and says how to change that', async () => {
		setBoardBridge(boardBridge())
		const run = vi.fn(async () => ok(null))
		registerOperation(
			defineOperation({
				id: 'test.write',
				title: 'Write',
				description: 'Changes something.',
				params: {},
				run,
			})
		)

		const { deps: d, sent } = deps({ readOnly: true })
		await handleServerMessage(frame({ type: 'invoke', id: 1, operation: 'test.write' }), d)

		expect(run).not.toHaveBeenCalled()
		const [reply] = sent
		if (reply?.type !== 'result' || reply.result.ok) throw new Error('expected a refusal')
		expect(reply.result.error).toContain('Settings → Agents')
	})

	it('still runs a read-only operation in read-only mode', async () => {
		setBoardBridge(boardBridge())
		registerOperation(
			defineOperation({
				id: 'test.read',
				title: 'Read',
				description: 'Reads something.',
				readOnly: true,
				params: {},
				run: async () => ok('data'),
			})
		)

		const { deps: d, sent } = deps({ readOnly: true })
		await handleServerMessage(frame({ type: 'invoke', id: 1, operation: 'test.read' }), d)
		expect(sent[0]).toMatchObject({ result: { ok: true, data: 'data' } })
	})

	it('reports a rejection to the caller so it can stop reconnecting', async () => {
		const onRejected = vi.fn()
		const { deps: d } = deps({ onRejected })
		await handleServerMessage(frame({ type: 'rejected', reason: 'bad token' }), d)
		expect(onRejected).toHaveBeenCalledWith('bad token')
	})

	it('ignores a welcome and says nothing back', async () => {
		const { deps: d, sent } = deps()
		await handleServerMessage(frame({ type: 'welcome', version: 1 }), d)
		expect(sent).toEqual([])
	})

	it('drops junk in silence — this socket receives noise by design', async () => {
		const { deps: d, sent } = deps()
		for (const raw of ['not json', frame({ type: 'nonsense' }), frame({ type: 'invoke' })]) {
			await handleServerMessage(raw, d)
		}
		expect(sent).toEqual([])
		expect(d.onRejected).not.toHaveBeenCalled()
	})
})
