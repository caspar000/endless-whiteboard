import type { Editor } from 'tldraw'
import { getBoardBridge, type BoardBridge } from './boardBridge'
import { registerCommand, type Command, type CommandContext } from './commands'
import { isExtensionEnabled, subscribeToNodeDefinitions } from './registry'

/**
 * Operations: the command table's sibling, for callers that are not a person at a keyboard.
 *
 * A `Command` is deliberately a *button* — `run(ctx)` takes no arguments and returns nothing
 * (`commands.ts`), which is exactly right for a palette row and exactly wrong for an agent. An agent
 * needs to say "create a note titled X at (80,140) with Price=2399, connect it to Y, and give me back
 * its id": named arguments in, a structured answer out, and a failure it can read and act on.
 *
 * So this is a second table with the same discipline — one registry every programmatic surface reads
 * as a view (the MCP server first; drill-in palette commands and a scripting API later) — rather than
 * a widening of `Command`, whose ids and shape are frozen by everything already reading them.
 *
 * The two tables are joined in one direction only, by `commandFromOperation`: new capability is
 * authored here once and *projected* onto a command, never written twice.
 */

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

export type ParamType = 'string' | 'number' | 'boolean' | 'string[]'

export interface ParamSpec {
	type: ParamType
	/**
	 * Written for the agent reading it, not as a form label — this is the entire UX of a tool call.
	 * Say what the value means and what happens when it is omitted.
	 */
	description: string
	/** Absent means optional. Optional params arrive as `undefined`, never as a default. */
	required?: boolean
	/** A closed set, when there is one. Narrows the argument's *type* as well as validating it. */
	choices?: readonly string[]
}

export type Params = Readonly<Record<string, ParamSpec>>

/** Flattens an intersection so a mismatch reports one object instead of `A & B`. */
type Prettify<T> = { [K in keyof T]: T[K] } & {}

type StringValue<P extends ParamSpec> = P extends { choices: readonly (infer C extends string)[] }
	? C
	: string

type ValueOf<P extends ParamSpec> = P['type'] extends 'string'
	? StringValue<P>
	: P['type'] extends 'number'
		? number
		: P['type'] extends 'boolean'
			? boolean
			: P['type'] extends 'string[]'
				? string[]
				: never

type RequiredKeys<P extends Params> = {
	[K in keyof P]: P[K]['required'] extends true ? K : never
}[keyof P]

/**
 * The argument object a `Params` describes, as a TypeScript type.
 *
 * This is the point of declaring parameters as data rather than as hand-written JSON Schema: the
 * type `run` receives and the schema the agent is shown are generated from one declaration, so they
 * cannot drift. Writing the schema by hand would make it unchecked strings, and getting it subtly
 * wrong is invisible until an agent sends the argument you didn't mean.
 */
export type Args<P extends Params> = Prettify<
	{ [K in RequiredKeys<P>]: ValueOf<P[K]> } & {
		[K in Exclude<keyof P, RequiredKeys<P>>]?: ValueOf<P[K]>
	}
>

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

/**
 * Every operation answers, and none of them throw.
 *
 * `ok: false` is a *normal* answer — "no board is open", "no shape with that id" — the same
 * discipline `fetchExchangeRates` follows by returning `null` rather than rejecting
 * (`PlatformAdapter.ts`). An agent that receives a sentence can act on it; one that receives a stack
 * trace can only give up. `runOperation` is the choke point that turns a thrown error into one of
 * these, so an operation *may* throw — it just never gets to surface that way.
 */
export type OperationResult = { ok: true; data: JsonValue } | { ok: false; error: string }

export function ok(data: JsonValue): OperationResult {
	return { ok: true, data }
}

export function fail(error: string): OperationResult {
	return { ok: false, error }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/**
 * What an operation runs against. Built fresh per invocation and never stored — the same rule
 * `CommandContext` states, for the same reason: an operation must not be able to act on a board that
 * has since closed.
 */
export interface OperationContext {
	/** The board the user is looking at; `null` on Home, Settings and Help. */
	editor: Editor | null
	/** Board-level capability, so an operation can target a board other than the active one. */
	boards: BoardBridge
}

/**
 * The context for the active board, or `null` when the host installed no `BoardBridge`.
 *
 * Both invokers go through this — the agent bridge and `commandFromOperation` — so there is one
 * answer to "what can an operation see", rather than each caller assembling its own.
 */
export function createOperationContext(editor: Editor | null): OperationContext | null {
	const boards = getBoardBridge()
	return boards ? { editor, boards } : null
}

// ---------------------------------------------------------------------------
// The operation
// ---------------------------------------------------------------------------

export interface Operation<P extends Params = Params> {
	/**
	 * Namespaced and stable: `board.create`, `node.insert`, `relation.connect`. Frozen once shipped,
	 * exactly like a command id — this is the name an agent's saved prompt references, so renaming
	 * one silently breaks work that already exists.
	 */
	id: string
	/** Short and imperative, for a human reading a log of what an agent did: "Insert node". */
	title: string
	/**
	 * What this does, when to reach for it, and what it returns. Required, unlike a command's
	 * (absent) description: an agent chooses a tool by reading this and nothing else.
	 */
	description: string
	params: P
	/**
	 * Whether this only reads. Defaults to mutating, because assuming a new operation is safe is the
	 * expensive direction to be wrong in. Lets a host offer a read-only session, and maps onto MCP's
	 * `readOnlyHint`.
	 */
	readOnly?: boolean
	run: (ctx: OperationContext, args: Args<P>) => Promise<OperationResult>
}

/**
 * An operation with its params type erased, so operations with different parameters can share one
 * table — `Operation` is invariant in `P` (`run` is contravariant in its args), so there is no common
 * supertype to declare the map as. The same problem `NodeDefinition<never>` has, solved the same way.
 *
 * The erasure is safe *because* arguments never arrive typed: they come off a socket as JSON and go
 * through `coerceArgs`, which validates them against the declared `params` at runtime. The cast
 * discards a compile-time guarantee that was never available at the call site anyway.
 */
export type RegisteredOperation = Operation<Params>

/**
 * Registers the params type before erasing it — the author's operation is fully checked against
 * `Operation<P>`, and `run` sees precisely typed args. The blessed cast, as `defineNode` is for
 * node definitions.
 */
export function defineOperation<P extends Params>(op: Operation<P>): RegisteredOperation {
	return op as unknown as RegisteredOperation
}

// ---------------------------------------------------------------------------
// The registry — deliberately `commands.ts`'s twin; read that file alongside this one
// ---------------------------------------------------------------------------

const operations = new Map<string, RegisteredOperation>()

/** Which extension registered each operation. Ownerless operations are core and cannot toggle off. */
const ownerById = new Map<string, string>()

const listeners = new Set<() => void>()

let visibleCache: RegisteredOperation[] | null = null

function invalidate(): void {
	visibleCache = null
	for (const listener of listeners) listener()
}

// Enablement lives in the node registry's store, and toggling an extension changes what should be
// offered here too — so chain its notifications rather than duplicating the state, exactly as the
// command registry does.
subscribeToNodeDefinitions(invalidate)

/**
 * Notifies on any change to the offered set. The MCP server subscribes to this to re-announce its
 * tool list (`notifications/tools/list_changed`) when an extension is toggled mid-session.
 */
export function subscribeToOperations(listener: () => void): () => void {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

/** Replace-by-id, for the HMR reason spelled out on `registerCommand`. */
export function registerOperation(op: RegisteredOperation, owner?: string): void {
	operations.set(op.id, op)
	if (owner !== undefined) ownerById.set(op.id, owner)
	else ownerById.delete(op.id)
	invalidate()
}

export function getOperation(id: string): RegisteredOperation | undefined {
	return operations.get(id)
}

/** Every registered operation in registration order, regardless of extension enablement. */
export function getOperations(): RegisteredOperation[] {
	return [...operations.values()]
}

/**
 * The operations a caller should be offered: those whose owning extension is enabled. Stable
 * snapshot between changes, so a `useSyncExternalStore` consumer does not loop.
 */
export function getVisibleOperations(): RegisteredOperation[] {
	visibleCache ??= [...operations.values()].filter((op) => {
		const owner = ownerById.get(op.id)
		return owner === undefined || isExtensionEnabled(owner)
	})
	return visibleCache
}

/** Used by tests to get a clean slate. Pair with `clearNodeRegistry`/`clearExtensionRegistry`. */
export function clearOperationRegistry(): void {
	operations.clear()
	ownerById.clear()
	invalidate()
}

// ---------------------------------------------------------------------------
// JSON Schema — the one place that dialect is spoken
// ---------------------------------------------------------------------------

export interface JsonSchemaProperty {
	type: 'string' | 'number' | 'boolean' | 'array'
	description: string
	enum?: string[]
	items?: { type: 'string' }
}

export interface JsonSchemaObject {
	type: 'object'
	properties: Record<string, JsonSchemaProperty>
	required: string[]
	/**
	 * An argument nobody declared is a mistake worth reporting. Silently dropping it is how an agent
	 * comes to believe it set a property that was never set, and then reasons on top of that.
	 */
	additionalProperties: false
}

export function toJsonSchema(params: Params): JsonSchemaObject {
	const properties: Record<string, JsonSchemaProperty> = {}
	const required: string[] = []
	for (const [name, spec] of Object.entries(params)) {
		const property: JsonSchemaProperty =
			spec.type === 'string[]'
				? { type: 'array', description: spec.description, items: { type: 'string' } }
				: { type: spec.type, description: spec.description }
		if (spec.choices) property.enum = [...spec.choices]
		properties[name] = property
		if (spec.required) required.push(name)
	}
	return { type: 'object', properties, required, additionalProperties: false }
}

/** An operation as a tool description — what the MCP server turns into its tool list. */
export interface OperationManifestEntry {
	id: string
	title: string
	description: string
	readOnly: boolean
	inputSchema: JsonSchemaObject
}

/**
 * The offered operations, described. This is the whole contract the server needs, which is what lets
 * the server contain no list of tools: an extension that contributes operations contributes tools.
 */
export function operationManifest(): OperationManifestEntry[] {
	return getVisibleOperations().map((op) => ({
		id: op.id,
		title: op.title,
		description: op.description,
		readOnly: op.readOnly === true,
		inputSchema: toJsonSchema(op.params),
	}))
}

// ---------------------------------------------------------------------------
// Argument validation — the real safety boundary
// ---------------------------------------------------------------------------

export type CoercedArgs =
	| { ok: true; args: Record<string, string | number | boolean | string[]> }
	| { ok: false; error: string }

/**
 * Turns whatever came off the wire into the declared arguments, or says why it can't.
 *
 * Two coercions are deliberate, and both exist because the alternative costs an agent a full
 * round trip to learn something it could not have known from the schema:
 *
 * - a numeric string where a number is declared (`"140"` → `140`), and
 * - a lone string where a list is declared (`"urgent"` → `["urgent"]`).
 *
 * Booleans are pointedly **not** coerced from strings. `"false"` is a non-empty string and therefore
 * truthy, so every plausible rule either silently inverts the caller's intent or invents a
 * string-literal dialect; rejecting it and saying so is the only honest option.
 */
export function coerceArgs(params: Params, raw: unknown): CoercedArgs {
	if (raw === null || raw === undefined) raw = {}
	if (typeof raw !== 'object' || Array.isArray(raw)) {
		return { ok: false, error: 'Arguments must be an object.' }
	}

	const input = raw as Record<string, unknown>
	const args: Record<string, string | number | boolean | string[]> = {}

	for (const key of Object.keys(input)) {
		if (!(key in params)) {
			const known = Object.keys(params)
			return {
				ok: false,
				error: `Unknown argument "${key}". Accepted: ${known.length ? known.join(', ') : '(none)'}.`,
			}
		}
	}

	for (const [name, spec] of Object.entries(params)) {
		const value = input[name]
		if (value === undefined || value === null) {
			if (spec.required) return { ok: false, error: `Missing required argument "${name}".` }
			continue
		}

		switch (spec.type) {
			case 'string': {
				if (typeof value !== 'string') {
					return { ok: false, error: `"${name}" must be a string.` }
				}
				if (spec.choices && !spec.choices.includes(value)) {
					return {
						ok: false,
						error: `"${name}" must be one of: ${spec.choices.join(', ')}. Got "${value}".`,
					}
				}
				args[name] = value
				break
			}
			case 'number': {
				const num = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
				if (typeof num !== 'number' || !Number.isFinite(num)) {
					return { ok: false, error: `"${name}" must be a finite number.` }
				}
				args[name] = num
				break
			}
			case 'boolean': {
				if (typeof value !== 'boolean') {
					return { ok: false, error: `"${name}" must be true or false, not a string.` }
				}
				args[name] = value
				break
			}
			case 'string[]': {
				const list = typeof value === 'string' ? [value] : value
				if (!Array.isArray(list) || list.some((item) => typeof item !== 'string')) {
					return { ok: false, error: `"${name}" must be an array of strings.` }
				}
				args[name] = list as string[]
				break
			}
		}
	}

	return { ok: true, args }
}

// ---------------------------------------------------------------------------
// Invocation
// ---------------------------------------------------------------------------

/**
 * The one way an operation is invoked from outside — look up, gate, validate, run, and turn anything
 * that goes wrong into a readable `ok: false`.
 *
 * Callers (the agent bridge, and later a scripting API) must go through this rather than reaching
 * for `op.run`, because everything that makes an unvalidated JSON payload safe to pass to a typed
 * `run` happens here.
 */
export async function runOperation(
	id: string,
	ctx: OperationContext,
	raw: unknown
): Promise<OperationResult> {
	const op = operations.get(id)
	if (!op) return fail(`Unknown operation "${id}".`)

	// Distinguished from "unknown" on purpose: an agent told the operation exists but is switched off
	// can ask the user to turn the extension back on. "Unknown" would send it hunting for a typo.
	if (!getVisibleOperations().includes(op)) {
		return fail(`"${id}" is unavailable: the extension that provides it is switched off.`)
	}

	const coerced = coerceArgs(op.params, raw)
	if (!coerced.ok) return fail(coerced.error)

	try {
		return await op.run(ctx, coerced.args as never)
	} catch (error) {
		return fail(error instanceof Error ? error.message : String(error))
	}
}

// ---------------------------------------------------------------------------
// The join with the command table
// ---------------------------------------------------------------------------

/**
 * Projects a zero-argument operation onto a `Command`, so capability that both an agent and a person
 * should have is authored once. The direction is fixed: operations are the richer table, and a
 * command is the view of one that needs no arguments.
 *
 * Refuses an operation with required parameters — there is nowhere to get them from until the
 * palette grows the drill-in page stack (issue #11), at which point that UI should be *generated*
 * from `params` rather than hand-written per command.
 *
 * Nothing existing moves onto this. Command ids are frozen and the current commands are fine; this
 * is for what comes next.
 */
export function commandFromOperation(
	op: RegisteredOperation,
	over: Partial<Pick<Command, 'title' | 'group' | 'icon' | 'kbd' | 'when'>> = {}
): Command {
	const required = Object.entries(op.params).filter(([, spec]) => spec.required)
	if (required.length > 0) {
		throw new Error(
			`Operation "${op.id}" needs arguments (${required
				.map(([name]) => name)
				.join(', ')}) and cannot become a command.`
		)
	}

	return {
		id: op.id,
		title: op.title,
		...over,
		run: (ctx: CommandContext) => {
			const opCtx = createOperationContext(ctx.editor)
			// No bridge means the host never installed one; a command has nowhere to report that, and
			// failing silently beats throwing out of a keypress handler.
			if (opCtx) void runOperation(op.id, opCtx, {})
		},
	}
}

/** Registers a zero-argument operation as a command too, keeping one id across both tables. */
export function registerOperationAsCommand(
	op: RegisteredOperation,
	over?: Partial<Pick<Command, 'title' | 'group' | 'icon' | 'kbd' | 'when'>>,
	owner?: string
): void {
	registerCommand(commandFromOperation(op, over), owner)
}
