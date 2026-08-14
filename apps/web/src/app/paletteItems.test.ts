import type { Command, CommandContext } from '@lifeboard/node-kit'
import type { Editor } from 'tldraw'
import { describe, expect, it } from 'vitest'
import type { BoardMeta } from '../boards/boardIndex'
import {
	APPEARANCE_GROUP,
	BOARDS_GROUP,
	CANVAS_GROUP,
	INSERT_GROUP,
	MAX_BOARDS,
	NAVIGATE_GROUP,
	buildPaletteItems,
	formatKbd,
	parseQuery,
} from './paletteItems'

function board(name: string, updatedAt = 0): BoardMeta {
	return { id: `id-${name}`, name, createdAt: 0, updatedAt }
}

function command(over: Partial<Command> = {}): Command {
	return { id: 'test.cmd', title: 'Test command', run: () => {}, ...over }
}

/**
 * A stand-in for the live editor. Commands only ever check it for presence here, so an empty object
 * is enough — cast once, in one place, rather than reaching for `any` at each call site.
 */
const STUB_EDITOR = {} as Editor

function ctx(over: Partial<CommandContext> = {}): CommandContext {
	return { editor: null, view: 'list', ...over }
}

const NAV_COMMANDS: Command[] = [
	command({ id: 'board.new', title: 'New board', group: BOARDS_GROUP }),
	command({ id: 'view.help', title: 'Open help', group: NAVIGATE_GROUP }),
	command({
		id: 'edit.undo',
		title: 'Undo',
		group: 'Canvas',
		kbd: 'cmd+z',
		when: (c) => c.editor !== null,
	}),
]

describe('parseQuery', () => {
	it('defaults to navigate and trims', () => {
		expect(parseQuery('')).toEqual({ mode: 'navigate', needle: '' })
		expect(parseQuery('  plan ')).toEqual({ mode: 'navigate', needle: 'plan' })
	})

	it('switches to commands on the > prefix', () => {
		expect(parseQuery('>')).toEqual({ mode: 'commands', needle: '' })
		expect(parseQuery('> zo')).toEqual({ mode: 'commands', needle: 'zo' })
	})
})

describe('buildPaletteItems — navigate mode', () => {
	const boards = [board('Roadmap'), board('Shopping list')]

	it('offers boards and only the navigation groups', () => {
		const items = buildPaletteItems({ query: '', ctx: ctx(), boards, commands: NAV_COMMANDS })
		expect(items.map((i) => i.title)).toEqual(['Roadmap', 'Shopping list', 'New board', 'Open help'])
		// Boards and "New board" share a section, so the renderer draws one header for the run.
		expect(items.slice(0, 3).every((i) => i.group === BOARDS_GROUP)).toBe(true)
	})

	it('filters boards and commands on a substring, anywhere in the title', () => {
		const items = buildPaletteItems({ query: 'op', ctx: ctx(), boards, commands: NAV_COMMANDS })
		expect(items.map((i) => i.title)).toEqual(['Shopping list', 'Open help'])
	})

	it('caps the board list', () => {
		const many = Array.from({ length: MAX_BOARDS + 5 }, (_, i) => board(`Board ${i}`))
		const items = buildPaletteItems({ query: '', ctx: ctx(), boards: many, commands: [] })
		expect(items).toHaveLength(MAX_BOARDS)
	})
})

describe('buildPaletteItems — commands mode', () => {
	it('hides commands whose `when` fails, and shows them when it passes', () => {
		const off = buildPaletteItems({ query: '>', ctx: ctx(), boards: [], commands: NAV_COMMANDS })
		expect(off.map((i) => i.title)).not.toContain('Undo')

		const on = buildPaletteItems({
			query: '>',
			ctx: ctx({ editor: STUB_EDITOR, view: 'board' }),
			boards: [],
			commands: NAV_COMMANDS,
		})
		expect(on.map((i) => i.title)).toContain('Undo')
	})

	it('never offers boards', () => {
		const items = buildPaletteItems({
			query: '> road',
			ctx: ctx(),
			boards: [board('Roadmap')],
			commands: [],
		})
		expect(items).toEqual([])
	})

	it('matches on the group name as well as the title', () => {
		const items = buildPaletteItems({
			query: '> canvas',
			ctx: ctx({ editor: STUB_EDITOR, view: 'board' }),
			boards: [],
			commands: NAV_COMMANDS,
		})
		expect(items.map((i) => i.title)).toEqual(['Undo'])
	})

	it('keeps each group contiguous and puts ungrouped commands last', () => {
		const commands = [
			command({ id: 'a', title: 'A', group: 'First' }),
			command({ id: 'loose', title: 'Loose' }),
			command({ id: 'b', title: 'B', group: 'Second' }),
			command({ id: 'c', title: 'C', group: 'First' }),
		]
		const items = buildPaletteItems({ query: '>', ctx: ctx(), boards: [], commands })
		expect(items.map((i) => i.title)).toEqual(['A', 'C', 'B', 'Loose'])
	})

	it('orders the app’s own sections by declaration, not by registration order', () => {
		// Registered back-to-front on purpose: which module happens to evaluate first must not be
		// what decides the palette's layout.
		const commands = [
			command({ id: 'x', title: 'Theme: Dark', group: APPEARANCE_GROUP }),
			command({ id: 'y', title: 'Undo', group: CANVAS_GROUP }),
			command({ id: 'z', title: 'Add note', group: INSERT_GROUP }),
			command({ id: 'w', title: 'Open help', group: NAVIGATE_GROUP }),
			command({ id: 'v', title: 'New board', group: BOARDS_GROUP }),
			command({ id: 'u', title: 'From a plugin', group: 'Vendor' }),
		]
		const items = buildPaletteItems({ query: '>', ctx: ctx(), boards: [], commands })
		expect(items.map((i) => i.group)).toEqual([
			INSERT_GROUP,
			CANVAS_GROUP,
			BOARDS_GROUP,
			NAVIGATE_GROUP,
			APPEARANCE_GROUP,
			// An extension's own group follows the app's, rather than landing wherever it registered.
			'Vendor',
		])
	})
})

describe('formatKbd', () => {
	it('renders mac symbols in the canonical modifier order', () => {
		expect(formatKbd('cmd+z', true)).toBe('⌘Z')
		// Written cmd-first, rendered shift-first — two spellings of a chord must look the same.
		expect(formatKbd('cmd+shift+z', true)).toBe('⇧⌘Z')
		expect(formatKbd('alt+p', true)).toBe('⌥P')
		expect(formatKbd('shift+1', true)).toBe('⇧1')
	})

	it('names modifiers off the Mac, without repeating Ctrl', () => {
		expect(formatKbd('cmd+shift+z', false)).toBe('Ctrl+Shift+Z')
		expect(formatKbd('cmd+ctrl+k', false)).toBe('Ctrl+K')
	})

	it('capitalises named keys', () => {
		expect(formatKbd('cmd+enter', true)).toBe('⌘Enter')
	})
})
