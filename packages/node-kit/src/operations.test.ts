import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearBoardBridge, setBoardBridge, type BoardBridge } from './boardBridge'
import { clearCommandRegistry, getCommand, getVisibleCommands } from './commands'
import { clearExtensionRegistry, registerExtension, type Extension } from './extensions'
import { clearNodeRegistry, setExtensionEnabled } from './registry'
import {
	clearOperationRegistry,
	coerceArgs,
	commandFromOperation,
	createOperationContext,
	defineOperation,
	fail,
	getOperation,
	getOperations,
	getVisibleOperations,
	ok,
	operationManifest,
	registerOperation,
	registerOperationAsCommand,
	requiredParams,
	runOperation,
	subscribeToOperations,
	toJsonSchema,
	type Args,
	type OperationContext,
	type Params,
	type RegisteredOperation,
} from './operations'

function bridge(): BoardBridge {
	return {
		list: vi.fn(async () => []),
		create: vi.fn(async (name: string) => ({ id: 'b1', name, createdAt: 0, updatedAt: 0 })),
		rename: vi.fn(async () => {}),
		remove: vi.fn(async () => {}),
		open: vi.fn(async () => null),
		editorFor: vi.fn(() => null),
	}
}

function context(): OperationContext {
	return { editor: null, boards: bridge() }
}

function operation(over: Partial<RegisteredOperation> = {}): RegisteredOperation {
	return defineOperation({
		id: 'test.noop',
		title: 'Noop',
		description: 'Does nothing.',
		params: {},
		run: async () => ok(null),
		...over,
	})
}

function extension(over: Partial<Extension> = {}): Extension {
	return { id: 'vendor.test', name: 'Test extension', nodes: [], ...over }
}

beforeEach(() => {
	clearOperationRegistry()
	clearCommandRegistry()
	clearExtensionRegistry()
	clearBoardBridge()
	// Also resets the disabled-extension set, which getVisibleOperations consults.
	clearNodeRegistry()
})

// ---------------------------------------------------------------------------
// The registry — the same contract as commands.ts, so the same tests hold
// ---------------------------------------------------------------------------

describe('registerOperation', () => {
	it('lists operations in registration order', () => {
		registerOperation(operation({ id: 'b.two' }))
		registerOperation(operation({ id: 'a.one' }))
		expect(getOperations().map((op) => op.id)).toEqual(['b.two', 'a.one'])
	})

	it('replaces on re-registration by id, keeping a single entry', () => {
		registerOperation(operation({ id: 'test.dup', title: 'Old' }))
		registerOperation(operation({ id: 'test.dup', title: 'New' }))
		expect(getOperations()).toHaveLength(1)
		expect(getOperation('test.dup')?.title).toBe('New')
	})
})

describe('getVisibleOperations', () => {
	it('is a stable snapshot between changes', () => {
		registerOperation(operation())
		const first = getVisibleOperations()
		expect(getVisibleOperations()).toBe(first)
		registerOperation(operation({ id: 'test.other' }))
		expect(getVisibleOperations()).not.toBe(first)
	})

	it('hides an extension-owned operation when the extension is disabled', () => {
		registerExtension(extension({ operations: [operation({ id: 'vendor.test.op' })] }))
		expect(getVisibleOperations().map((op) => op.id)).toEqual(['vendor.test.op'])

		setExtensionEnabled('vendor.test', false)
		expect(getVisibleOperations()).toEqual([])
		// "Stop offering, never stop working": the operation itself stays registered.
		expect(getOperation('vendor.test.op')).toBeDefined()

		setExtensionEnabled('vendor.test', true)
		expect(getVisibleOperations().map((op) => op.id)).toEqual(['vendor.test.op'])
	})
})

describe('subscribeToOperations', () => {
	it('notifies on registration and on enablement flips, until unsubscribed', () => {
		const listener = vi.fn()
		const unsubscribe = subscribeToOperations(listener)

		registerOperation(operation())
		expect(listener).toHaveBeenCalledTimes(1)

		setExtensionEnabled('vendor.test', false)
		expect(listener).toHaveBeenCalledTimes(2)

		unsubscribe()
		registerOperation(operation({ id: 'test.other' }))
		expect(listener).toHaveBeenCalledTimes(2)
	})
})

// ---------------------------------------------------------------------------
// Schema generation
// ---------------------------------------------------------------------------

describe('toJsonSchema', () => {
	it('describes every param type, with required and choices', () => {
		const schema = toJsonSchema({
			title: { type: 'string', description: 'The title', required: true },
			count: { type: 'number', description: 'How many' },
			pinned: { type: 'boolean', description: 'Pin it' },
			tags: { type: 'string[]', description: 'Labels' },
			mode: { type: 'string', description: 'Which mode', choices: ['fast', 'slow'] },
		})

		expect(schema.type).toBe('object')
		expect(schema.additionalProperties).toBe(false)
		expect(schema.required).toEqual(['title'])
		expect(schema.properties.count).toEqual({ type: 'number', description: 'How many' })
		expect(schema.properties.pinned).toEqual({ type: 'boolean', description: 'Pin it' })
		expect(schema.properties.tags).toEqual({
			type: 'array',
			description: 'Labels',
			items: { type: 'string' },
		})
		expect(schema.properties.mode?.enum).toEqual(['fast', 'slow'])
	})

	it('copies choices rather than aliasing them, so a schema cannot mutate a declaration', () => {
		const choices = ['a', 'b'] as const
		const schema = toJsonSchema({ mode: { type: 'string', description: 'm', choices } })
		expect(schema.properties.mode?.enum).not.toBe(choices)
	})

	it('produces an empty object schema for a no-argument operation', () => {
		expect(toJsonSchema({})).toEqual({
			type: 'object',
			properties: {},
			required: [],
			additionalProperties: false,
		})
	})
})

describe('operationManifest', () => {
	it('describes the visible operations, defaulting readOnly to false', () => {
		registerOperation(
			operation({ id: 'test.read', description: 'Reads things.', readOnly: true })
		)
		registerOperation(operation({ id: 'test.write' }))

		expect(operationManifest()).toEqual([
			{
				id: 'test.read',
				title: 'Noop',
				description: 'Reads things.',
				readOnly: true,
				inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
			},
			{
				id: 'test.write',
				title: 'Noop',
				description: 'Does nothing.',
				readOnly: false,
				inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
			},
		])
	})
})

// ---------------------------------------------------------------------------
// Argument validation — everything an agent can get wrong
// ---------------------------------------------------------------------------

describe('coerceArgs', () => {
	const params: Params = {
		title: { type: 'string', description: 'The title', required: true },
		count: { type: 'number', description: 'How many' },
		pinned: { type: 'boolean', description: 'Pin it' },
		tags: { type: 'string[]', description: 'Labels' },
		mode: { type: 'string', description: 'Which mode', choices: ['fast', 'slow'] },
	}

	it('accepts a well-formed payload and omits absent optionals', () => {
		const result = coerceArgs(params, { title: 'Hello' })
		expect(result).toEqual({ ok: true, args: { title: 'Hello' } })
	})

	it('names the missing required argument', () => {
		expect(coerceArgs(params, {})).toEqual({
			ok: false,
			error: 'Missing required argument "title".',
		})
	})

	it('rejects an undeclared argument and lists what it could have meant', () => {
		const result = coerceArgs(params, { title: 'x', colour: 'red' })
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error).toContain('Unknown argument "colour"')
		expect(result.error).toContain('title')
	})

	it('reads a numeric string as a number', () => {
		expect(coerceArgs(params, { title: 'x', count: '140' })).toEqual({
			ok: true,
			args: { title: 'x', count: 140 },
		})
	})

	it('rejects a number that is not one', () => {
		expect(coerceArgs(params, { title: 'x', count: 'lots' }).ok).toBe(false)
		expect(coerceArgs(params, { title: 'x', count: Number.NaN }).ok).toBe(false)
		expect(coerceArgs(params, { title: 'x', count: Number.POSITIVE_INFINITY }).ok).toBe(false)
	})

	it('wraps a lone string into a list', () => {
		expect(coerceArgs(params, { title: 'x', tags: 'urgent' })).toEqual({
			ok: true,
			args: { title: 'x', tags: ['urgent'] },
		})
	})

	it('rejects a list that is not all strings', () => {
		expect(coerceArgs(params, { title: 'x', tags: ['a', 3] }).ok).toBe(false)
	})

	it('refuses a stringly boolean rather than guessing', () => {
		// "false" is truthy, so any coercion rule here silently inverts somebody's intent.
		const result = coerceArgs(params, { title: 'x', pinned: 'false' })
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error).toContain('true or false')
	})

	it('enforces choices and shows them', () => {
		const result = coerceArgs(params, { title: 'x', mode: 'medium' })
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error).toContain('fast, slow')
	})

	it('treats a null or missing payload as no arguments', () => {
		expect(coerceArgs({}, null)).toEqual({ ok: true, args: {} })
		expect(coerceArgs({}, undefined)).toEqual({ ok: true, args: {} })
	})

	it('rejects a payload that is not an object', () => {
		expect(coerceArgs({}, 'title=x').ok).toBe(false)
		expect(coerceArgs({}, ['x']).ok).toBe(false)
	})

	it('treats an explicit null for an optional argument as absent', () => {
		expect(coerceArgs(params, { title: 'x', count: null })).toEqual({
			ok: true,
			args: { title: 'x' },
		})
	})
})

// ---------------------------------------------------------------------------
// Invocation
// ---------------------------------------------------------------------------

describe('runOperation', () => {
	it('runs a visible operation with validated arguments', async () => {
		const run = vi.fn(async () => ok({ created: 1 }))
		registerOperation(
			operation({
				id: 'test.create',
				params: { name: { type: 'string', description: 'n', required: true } },
				run,
			})
		)

		const ctx = context()
		await expect(runOperation('test.create', ctx, { name: 'Board' })).resolves.toEqual({
			ok: true,
			data: { created: 1 },
		})
		expect(run).toHaveBeenCalledWith(ctx, { name: 'Board' })
	})

	it('reports an unknown id', async () => {
		await expect(runOperation('test.nope', context(), {})).resolves.toEqual({
			ok: false,
			error: 'Unknown operation "test.nope".',
		})
	})

	it('distinguishes a switched-off operation from an unknown one', async () => {
		registerExtension(extension({ operations: [operation({ id: 'vendor.test.op' })] }))
		setExtensionEnabled('vendor.test', false)

		const result = await runOperation('vendor.test.op', context(), {})
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error).toContain('switched off')
	})

	it('returns validation failures without running anything', async () => {
		const run = vi.fn(async () => ok(null))
		registerOperation(
			operation({
				id: 'test.needs',
				params: { name: { type: 'string', description: 'n', required: true } },
				run,
			})
		)

		const result = await runOperation('test.needs', context(), {})
		expect(result).toEqual({ ok: false, error: 'Missing required argument "name".' })
		expect(run).not.toHaveBeenCalled()
	})

	it('turns a thrown error into a readable result', async () => {
		registerOperation(
			operation({
				id: 'test.throws',
				run: async () => {
					throw new Error('the board went away')
				},
			})
		)
		await expect(runOperation('test.throws', context(), {})).resolves.toEqual({
			ok: false,
			error: 'the board went away',
		})
	})

	it('survives a thrown non-Error', async () => {
		registerOperation(
			operation({
				id: 'test.throws-string',
				run: async () => {
					throw 'nope'
				},
			})
		)
		const result = await runOperation('test.throws-string', context(), {})
		expect(result).toEqual({ ok: false, error: 'nope' })
	})
})

// ---------------------------------------------------------------------------
// The seam and the join with commands
// ---------------------------------------------------------------------------

describe('createOperationContext', () => {
	it('is null until the host installs a board bridge', () => {
		expect(createOperationContext(null)).toBeNull()
		setBoardBridge(bridge())
		expect(createOperationContext(null)).not.toBeNull()
	})
})

describe('commandFromOperation', () => {
	it('keeps the id, so one capability has one name in both tables', () => {
		const command = commandFromOperation(operation({ id: 'test.go', title: 'Go' }))
		expect(command.id).toBe('test.go')
		expect(command.title).toBe('Go')
	})

	it('names the arguments an argument-collecting surface has to gather, in order', () => {
		const op = operation({
			id: 'test.needs',
			params: {
				name: { type: 'string', description: 'n', required: true },
				// Not required, so no page is generated for it: the palette asks for the minimum that
				// makes the operation run, and everything else keeps its default.
				unit: { type: 'string', description: 'u' },
				type: { type: 'string', description: 't', required: true, choices: ['a', 'b'] },
			},
		})
		expect(requiredParams(op).map((param) => param.name)).toEqual(['name', 'type'])
		expect(requiredParams(op)[1]?.spec.choices).toEqual(['a', 'b'])
		expect(requiredParams(operation({ id: 'test.none' }))).toEqual([])
	})

	it('still projects an operation that needs arguments — the command is a doorway', () => {
		const run = vi.fn(async () => ok(null))
		const op = operation({
			id: 'test.needs2',
			params: { name: { type: 'string', description: 'n', required: true } },
			run,
		})
		registerOperation(op)
		setBoardBridge(bridge())

		const command = commandFromOperation(op)
		expect(command.id).toBe('test.needs2')
		// Invoked without going through a surface that collects arguments, it reports rather than
		// runs: the operation's own validation refuses it, and nothing throws out of the handler.
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
		expect(() => command.run({ editor: null, view: 'board' })).not.toThrow()
		return vi.waitFor(() => {
			expect(run).not.toHaveBeenCalled()
			expect(warn).toHaveBeenCalledWith(expect.stringContaining('Missing required argument'))
			warn.mockRestore()
		})
	})

	it('runs the operation, and does nothing rather than throwing with no bridge', async () => {
		const run = vi.fn(async () => ok(null))
		const op = operation({ id: 'test.go', run })
		registerOperation(op)

		const command = commandFromOperation(op)
		// No bridge installed: a keypress handler has nowhere to report this, so it must stay quiet.
		expect(() => command.run({ editor: null, view: 'board' })).not.toThrow()
		expect(run).not.toHaveBeenCalled()

		setBoardBridge(bridge())
		command.run({ editor: null, view: 'board' })
		await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1))
	})

	it('registers into the command table with an owner, so one toggle hides both', () => {
		const op = operation({ id: 'vendor.test.op' })
		registerExtension(extension({ operations: [op] }))
		registerOperationAsCommand(op, { group: 'Test' }, 'vendor.test')

		expect(getCommand('vendor.test.op')?.group).toBe('Test')
		setExtensionEnabled('vendor.test', false)
		expect(getVisibleCommands()).toEqual([])
		expect(getVisibleOperations()).toEqual([])
	})
})

// ---------------------------------------------------------------------------
// Types. These assertions are checked by `pnpm typecheck`, not at runtime — a regression in the
// `Args` mapping shows up as a compile error in this file.
// ---------------------------------------------------------------------------

const TYPED_PARAMS = {
	title: { type: 'string', description: 'The title', required: true },
	count: { type: 'number', description: 'How many' },
	tags: { type: 'string[]', description: 'Labels' },
	mode: { type: 'string', description: 'Which mode', choices: ['fast', 'slow'] },
} as const satisfies Params

function typeAssertions(args: Args<typeof TYPED_PARAMS>): string {
	// Required, so not `| undefined`.
	const title: string = args.title
	// Optional, so it is.
	const count: number | undefined = args.count
	const tags: string[] | undefined = args.tags
	// `choices` narrows the value type, not just the runtime check.
	const mode: 'fast' | 'slow' | undefined = args.mode
	return `${title}${count ?? 0}${tags?.join('') ?? ''}${mode ?? ''}`
}

describe('Args', () => {
	it('maps a declaration onto the argument object run receives', () => {
		expect(typeAssertions({ title: 'x', count: 2, tags: ['a'], mode: 'fast' })).toBe('x2afast')
		expect(typeAssertions({ title: 'x' })).toBe('x0')
	})
})

describe('result helpers', () => {
	it('build the two answers', () => {
		expect(ok({ id: 'a' })).toEqual({ ok: true, data: { id: 'a' } })
		expect(fail('nope')).toEqual({ ok: false, error: 'nope' })
	})
})
