import {
	getOperation,
	registerExtension,
	runOperation,
	type OperationContext,
} from '@lifeboard/node-kit'
import type { Editor } from 'tldraw'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { diceExtension } from './extension'
import { clearRolls, getActiveRoll } from './rolls'

/**
 * The agent's half of this extension, pinned.
 *
 * Worth a test precisely because it has no UI: nothing on screen changes if `dice.roll` stops
 * accepting `2d6`, so the only thing that would notice is an agent mid-conversation. `views-plan.md`
 * makes the same argument for the same reason.
 */

/** Just enough editor for this operation: it reads the viewport and nothing else. */
function fakeEditor(): Editor {
	return {
		getViewportPageBounds: () => ({ center: { x: 640, y: 480 } }),
	} as unknown as Editor
}

function context(editor: Editor | null): OperationContext {
	// `boards` is never touched — this operation acts on the board in front of the user, and cannot
	// target another one, because a roll nobody is looking at is not a roll.
	return { editor, boards: {} as OperationContext['boards'] }
}

beforeAll(() => registerExtension(diceExtension))
beforeEach(() => clearRolls())

/**
 * Invoked through `runOperation` rather than by reaching for `op.run` directly — which is both how the
 * agent bridge calls it and the only way to get argument *coercion* under test, since a registered
 * operation has its params type erased and would take `run(ctx, args)` as `never`.
 */
const run = (notation: unknown, editor: Editor | null = fakeEditor()) =>
	runOperation('dice.roll', context(editor), { notation })

describe('dice.roll', () => {
	it('is contributed by the extension, and is not read-only', () => {
		const op = getOperation('dice.roll')
		expect(op).toBeDefined()
		// It animates on someone's screen and consumes randomness, so calling it twice differs from
		// calling it once — read-only mode must not offer it.
		expect(op?.readOnly).not.toBe(true)
	})

	it('rolls the notation and returns each die with the total', async () => {
		const result = await run('2d6 + 1d12')
		expect(result.ok).toBe(true)
		if (!result.ok) return
		const data = result.data as { notation: string; dice: { die: string; value: number }[]; total: number }
		expect(data.notation).toBe('2d6 + 1d12')
		expect(data.dice.map((d) => d.die)).toEqual(['d6', 'd6', 'd12'])
		expect(data.total).toBe(data.dice.reduce((sum, d) => sum + d.value, 0))
		for (const die of data.dice) {
			expect(die.value).toBeGreaterThanOrEqual(1)
			expect(die.value).toBeLessThanOrEqual(die.die === 'd12' ? 12 : 6)
		}
	})

	it('throws it on the board, at the middle of what the user is looking at', async () => {
		await run('d20')
		// The point of the operation being an operation: the roll lands on the live board rather than
		// only in the answer.
		expect(getActiveRoll()?.point).toEqual({ x: 640, y: 480 })
		expect(getActiveRoll()?.result.notation).toBe('1d20')
	})

	it('refuses a die that does not exist, naming the ones that do', async () => {
		const result = await run('d7')
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error).toContain('no d7')
		expect(result.error).toContain('d20')
		// A refused call must not leave a roll on the board.
		expect(getActiveRoll()).toBeNull()
	})

	it('refuses a missing notation before it ever reaches the parser', async () => {
		// `coerceArgs` rejects this from the declared params, which is why `notation` is `required`.
		const result = await run(undefined)
		expect(result.ok).toBe(false)
		expect(getActiveRoll()).toBeNull()
	})

	it('refuses when no board is open, and says what to do about it', async () => {
		const result = await run('d20', null)
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error).toContain('board')
	})

	it('describes itself with the dice it actually ships', async () => {
		// The description is the entire UX of a tool call, and it is generated from DIE_KINDS rather
		// than retyped — so a die added to the tray reaches the agent's tool description too.
		const op = getOperation('dice.roll')
		expect(op?.description).toContain('d100')
		expect(op?.description).toContain('d4')
		expect(op?.params.notation?.required).toBe(true)
	})
})
