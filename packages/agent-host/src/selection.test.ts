import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentBridge } from '@lifeboard/mcp-server/bridge'
import type { OperationManifestEntry } from '@lifeboard/mcp-server/protocol'

/**
 * The model and effort the composer picked, all the way to the SDK.
 *
 * This is asserted against a mocked `query` rather than a live conversation because the thing worth
 * pinning is the *contract*: which option carries the model, which control request changes it, and
 * when the session decides it has nothing to change. A real turn would prove the wiring once and tell
 * us nothing about the case that actually costs money — a selection quietly not being applied.
 */

interface FakeQuery {
	options: Record<string, unknown>
	setModel: ReturnType<typeof vi.fn>
	applyFlagSettings: ReturnType<typeof vi.fn>
}

const queries: FakeQuery[] = []

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
	query: ({ options }: { options: Record<string, unknown> }) => {
		const record: FakeQuery = {
			options,
			setModel: vi.fn(async () => {}),
			applyFlagSettings: vi.fn(async () => {}),
		}
		queries.push(record)
		// Enough of a `Query` for the session: an async iterable that never yields, plus the control
		// requests. The drain loop finishes immediately and leaves `live` set until `end()`.
		return {
			...record,
			[Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
			interrupt: async () => {},
			close: () => {},
			setMcpServers: async () => {},
		}
	},
	listSessions: async () => [],
	getSessionMessages: async () => [],
	deleteSession: async () => {},
}))

const { AgentSession } = await import('./session.js')

const manifest: OperationManifestEntry[] = [
	{
		id: 'node.insert',
		title: 'Insert node',
		description: 'Adds a node.',
		readOnly: false,
		inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
	},
]

/** Only the surface `AgentSession` touches. A real bridge would need a socket and a port. */
function fakeBridge(): AgentBridge {
	return {
		getManifest: () => manifest,
		onManifestChange: () => () => {},
		send: () => {},
		sendChat: () => {},
	} as unknown as AgentBridge
}

function session(options: { model?: string } = {}) {
	return new AgentSession({ bridge: fakeBridge(), ...options })
}

beforeEach(() => {
	queries.length = 0
})

describe('opening a conversation', () => {
	it("starts on the composer's model and effort, not the launch default", async () => {
		const agent = session({ model: 'claude-opus-5' })
		await agent.run('add a note', [], { model: 'claude-sonnet-5', effort: 'low' })

		// The first turn has to *start* on what was picked. Starting on the flag and switching after
		// would spend the opening turn — the expensive one, carrying the whole system prompt — on the
		// wrong model.
		expect(queries).toHaveLength(1)
		expect(queries[0]?.options.model).toBe('claude-sonnet-5')
		expect(queries[0]?.options.effort).toBe('low')
	})

	it('falls back to the launch model when the panel sends no selection', async () => {
		const agent = session({ model: 'claude-opus-5' })
		await agent.run('add a note')

		expect(queries[0]?.options.model).toBe('claude-opus-5')
		// Absent rather than defaulted: Claude Code's own default should apply, and guessing what that
		// is would be this process inventing a policy it does not own.
		expect(queries[0]?.options.effort).toBeUndefined()
	})
})

describe('changing the selection mid-conversation', () => {
	it('steers the live conversation rather than starting a new one', async () => {
		const agent = session()
		await agent.run('first', [], { model: 'claude-sonnet-5', effort: 'low' })
		await agent.run('second', [], { model: 'claude-opus-5', effort: 'max' })

		// One query, not two: the context the user is halfway through survives the switch, which is the
		// whole point — somebody reaching for a stronger model does so *because* the turn went wrong.
		expect(queries).toHaveLength(1)
		expect(queries[0]?.setModel).toHaveBeenCalledWith('claude-opus-5')
		expect(queries[0]?.applyFlagSettings).toHaveBeenCalledWith({ effortLevel: 'max' })
	})

	it('says nothing when nothing changed', async () => {
		const agent = session()
		await agent.run('first', [], { model: 'claude-sonnet-5', effort: 'low' })
		await agent.run('second', [], { model: 'claude-sonnet-5', effort: 'low' })

		// A control request per turn would be harmless and wrong: it is the comparison against what the
		// conversation is *already* running that makes this cheap enough to do on every send.
		expect(queries[0]?.setModel).not.toHaveBeenCalled()
		expect(queries[0]?.applyFlagSettings).not.toHaveBeenCalled()
	})

	it('clears the level for a model that has no reasoning control', async () => {
		const agent = session()
		await agent.run('first', [], { model: 'claude-opus-5', effort: 'max' })
		await agent.run('second', [], { model: 'claude-haiku-4-5', effort: null })

		// `null`, not omitted. Leaving `max` applied would keep charging for a setting the new model
		// cannot use, which is exactly the failure this whole control exists to prevent.
		expect(queries[0]?.applyFlagSettings).toHaveBeenCalledWith({ effortLevel: null })
	})

	it('keeps sending the turn when a control request fails', async () => {
		const agent = session()
		await agent.run('first', [], { model: 'claude-sonnet-5', effort: 'low' })
		queries[0]?.setModel.mockRejectedValueOnce(new Error('control request refused'))

		// A model that could not be switched means the turn runs on the previous one — a worse answer
		// than was asked for. Dropping the turn would be no answer at all.
		await expect(agent.run('second', [], { model: 'claude-opus-5', effort: 'low' })).resolves
			.toBeUndefined()
		expect(queries).toHaveLength(1)
	})
})
