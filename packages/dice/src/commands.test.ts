import { describe, expect, it } from 'vitest'
import type { CommandContext } from '@lifeboard/node-kit'
import type { Editor } from 'tldraw'
import { diceCommandSource } from './commands'
import { clearRolls, getActiveRoll } from './rolls'

/** Just enough editor: the source only asks where the middle of the view is. */
const editor = { getViewportPageBounds: () => ({ center: { x: 100, y: 200 } }) } as unknown as Editor
const onBoard: CommandContext = { editor, view: 'board' }
const offBoard: CommandContext = { editor: null, view: 'list' }

const offer = (query: string, ctx: CommandContext = onBoard) => diceCommandSource.offer(query, ctx)

describe('> roll <notation>', () => {
	it('offers a roll for a notation, titled with what it will throw', () => {
		const [command, ...rest] = offer('roll 2d20 + 10')
		expect(rest).toHaveLength(0)
		expect(command!.title).toBe('Roll 2d20 + 10')
	})

	it('throws immediately, at the middle of the view, with the modifier applied', () => {
		clearRolls()
		offer('roll 2d20 + 10')[0]!.run(onBoard)
		const roll = getActiveRoll()
		expect(roll?.point).toEqual({ x: 100, y: 200 })
		expect(roll?.result.dice).toHaveLength(2)
		expect(roll?.result.modifier).toBe(10)
		// The modifier is in the total, not merely beside it.
		const faces = roll!.result.dice.reduce((sum, die) => sum + die.value, 0)
		expect(roll?.result.total).toBe(faces + 10)
	})

	it('handles a long mixed expression', () => {
		const [command] = offer('roll 1d6 + 2d4 + 1d20 + 4')
		expect(command!.title).toBe('Roll 2d4 + 1d6 + 1d20 + 4')
	})

	it('is browsable: found while the word is still being typed, and with nothing typed at all', () => {
		// A command you have to know the name of before it appears is one you never discover. Every prefix
		// of the word finds it, and an empty query lists it with everything else.
		for (const query of ['', 'r', 'ro', 'rol', 'roll']) {
			expect(offer(query), `"${query}"`).toHaveLength(1)
			expect(offer(query)[0]!.title, `"${query}"`).toBe('Roll a d20')
		}
		// But not a prefix of something else.
		expect(offer('x')).toHaveLength(0)
		expect(offer('note')).toHaveLength(0)
	})

	it('offers the default roll for the bare word, and teaches the syntax', () => {
		for (const query of ['roll', 'roll ']) {
			const [command, ...rest] = offer(query)
			expect(rest, query).toHaveLength(0)
			expect(command!.title, query).toBe('Roll a d20')
			expect(command!.hint, query).toContain('2d20 + 10')
			expect(command!.runnable, query).not.toBe(false)
		}
	})

	it('rolls a d20 when the word is used alone', () => {
		clearRolls()
		offer('roll')[0]!.run(onBoard)
		expect(getActiveRoll()?.result.notation).toBe('1d20')
	})

	it('says why a notation it cannot roll will not roll, without being runnable', () => {
		for (const [query, because] of [
			['roll 2d7', 'no d7'],
			['roll nonsense', 'Could not read'],
			['roll 5', 'no dice'],
			['roll 2d6 +', 'operator'],
		] as const) {
			const [command, ...rest] = offer(query)
			expect(rest, query).toHaveLength(0)
			expect(command!.hint, query).toContain(because)
			// Present so the reason is visible; inert so Enter is not a dead end.
			expect(command!.runnable, query).toBe(false)
		}
	})

	it('does not throw anything from a row that cannot roll', () => {
		clearRolls()
		offer('roll 2d7')[0]!.run(onBoard)
		expect(getActiveRoll()).toBeNull()
	})

	it('does not answer for a word that merely starts the same way', () => {
		// `rollup` is a node type this app has had for longer than it has had dice.
		expect(offer('rollup 2d6')).toHaveLength(0)
		expect(offer('rolling 2d6')).toHaveLength(0)
		expect(offer('rollup')).toHaveLength(0)
	})

	it('is case- and space-insensitive about the word itself', () => {
		expect(offer('Roll 2d6')).toHaveLength(1)
		expect(offer('  ROLL   2d6  ')).toHaveLength(1)
	})

	it('offers nothing off a board, where there is nowhere to throw', () => {
		expect(offer('roll 2d6', offBoard)).toHaveLength(0)
	})
})
