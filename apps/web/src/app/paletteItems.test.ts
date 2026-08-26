import { defineOperation, type Command, type CommandContext } from '@lifeboard/node-kit'
import type { Editor, TLShapeId } from 'tldraw'
import { describe, expect, it } from 'vitest'
import type { BoardMeta } from '../boards/boardIndex'
import {
	APPEARANCE_GROUP,
	BOARDS_GROUP,
	CANVAS_GROUP,
	FIND_GROUP,
	INSERT_GROUP,
	MAX_BOARDS,
	MAX_SHAPES,
	NAVIGATE_GROUP,
	answerDrillIn,
	beginDrillIn,
	ANSWER_GROUP,
	EXPRESSION_GROUP,
	buildPaletteItems,
	currentParam,
	drillInArgs,
	drillInCrumbs,
	drillInEmptyMessage,
	drillInItems,
	emptyMessage,
	expressionBody,
	expressionFooter,
	formatKbd,
	splitSaveClause,
	isComplete,
	parseQuery,
	popDrillIn,
	type BoardShapeRef,
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

	it('switches to find on the @ prefix', () => {
		expect(parseQuery('@')).toEqual({ mode: 'find', needle: '' })
		expect(parseQuery('@ inv')).toEqual({ mode: 'find', needle: 'inv' })
	})

	it('switches to expressions on the = prefix', () => {
		expect(parseQuery('=')).toEqual({ mode: 'expression', needle: '' })
		expect(parseQuery('= sum price')).toEqual({ mode: 'expression', needle: 'sum price' })
	})

	it('keeps the expression body untrimmed — a trailing space is a step in the menu', () => {
		// `sum` is still choosing a verb; `sum ` has chosen one and is asking what to sum. The `{…}`
		// menu is positional, so collapsing the two would collapse the menu.
		expect(expressionBody('= sum')).toBe(' sum')
		expect(expressionBody('= sum ')).toBe(' sum ')
		expect(expressionBody('not an expression')).toBe('')
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

function shape(label: string): BoardShapeRef {
	return { id: `shape:${label}` as TLShapeId, type: 'node.markdown', label }
}

describe('buildPaletteItems — find mode', () => {
	// As `readBoardShapes` hands them over: nearest the middle of the view first.
	const shapes = [shape('Kitchen budget'), shape('Budget review'), shape('Holiday')]

	const find = (query: string, over: Partial<{ shapes: BoardShapeRef[] }> = {}) =>
		buildPaletteItems({
			query,
			ctx: ctx({ editor: STUB_EDITOR, view: 'board' }),
			boards: [board('Roadmap')],
			commands: NAV_COMMANDS,
			shapes,
			...over,
		})

	it('keeps the order it was given, and offers nothing but shapes', () => {
		const items = find('@')
		expect(items.map((i) => i.title)).toEqual(['Kitchen budget', 'Budget review', 'Holiday'])
		// Neither a board nor a command leaks in: `@` is its own mode, not a filter over the others.
		expect(items.every((i) => i.kind === 'shape')).toBe(true)
		expect(items.every((i) => i.group === FIND_GROUP)).toBe(true)
	})

	it('filters on a substring anywhere in the label, not just the start', () => {
		expect(find('@ review').map((i) => i.title)).toEqual(['Budget review'])
		expect(find('@ day').map((i) => i.title)).toEqual(['Holiday'])
	})

	it('promotes a label that starts with what was typed over one that merely contains it', () => {
		// "Budget review" is further from the camera than "Kitchen budget" and still wins: someone
		// typing `budget` is naming a thing, not describing one.
		expect(find('@ bud').map((i) => i.title)).toEqual(['Budget review', 'Kitchen budget'])
	})

	it('caps the list', () => {
		const many = Array.from({ length: MAX_SHAPES + 5 }, (_, i) => shape(`Shape ${i}`))
		expect(find('@', { shapes: many })).toHaveLength(MAX_SHAPES)
	})

	it('carries the shape id, so running a row has something to select', () => {
		const [first] = find('@ holiday')
		expect(first).toMatchObject({ kind: 'shape', shapeId: 'shape:Holiday' })
	})

	it('offers nothing when there is no board — the palette says why instead', () => {
		expect(buildPaletteItems({ query: '@', ctx: ctx(), boards: [], commands: [] })).toEqual([])
		expect(emptyMessage('find', false)).toBe('Open a board to search what is on it')
		// With a board open, an empty list means the search genuinely found nothing.
		expect(emptyMessage('find', true)).toBe('No matches')
		expect(emptyMessage('navigate', false)).toBe('No matches')
	})
})

describe('buildPaletteItems — expression mode', () => {
	const rows = (expression: Parameters<typeof buildPaletteItems>[0]['expression']) =>
		buildPaletteItems({
			query: '= sum price',
			ctx: ctx({ editor: STUB_EDITOR, view: 'board' }),
			boards: [board('Roadmap')],
			commands: NAV_COMMANDS,
			expression,
		})

	const preview = {
		result: '£12,480',
		explicit: 'sum price page',
		completions: [{ label: 'page', detail: 'everything on this board', query: '= sum price page' }],
	}

	it('offers the answer twice — to take away, and to leave behind', () => {
		const items = rows(preview)
		expect(items.slice(0, 2)).toMatchObject([
			{ kind: 'expression', action: 'copy', title: '£12,480', group: ANSWER_GROUP },
			{ kind: 'expression', action: 'drop', group: ANSWER_GROUP },
		])
		// The drop row promises the *question*, because that is what gets written to the board.
		expect(items[1]?.title).toContain('{sum price page}')
	})

	it('carries the explicit question, not the answer, for the row that writes it down', () => {
		const [, drop] = rows(preview)
		// The question is what a dropped shape re-evaluates for itself; the number would be dead on
		// arrival.
		expect(drop).toMatchObject({ action: 'drop', explicit: 'sum price page' })
	})

	it('offers to save once a usable name is being typed', () => {
		const items = rows({ ...preview, saveAs: { name: 'runway', problem: null } })
		expect(items.filter((i) => i.kind === 'expression')).toMatchObject([
			{ action: 'copy' },
			{ action: 'drop' },
			{ action: 'save', name: 'runway', body: 'sum price page' },
		])
	})

	it('refuses a name in the footer rather than as a row that does nothing', () => {
		const refused = { ...preview, saveAs: { name: 'sum', problem: '“sum” already means something.' } }
		expect(rows(refused).some((i) => i.kind === 'expression' && i.action === 'save')).toBe(false)
		expect(expressionFooter(refused)).toBe('“sum” already means something.')
	})

	it('teaches the save clause while there is an answer and no name yet', () => {
		expect(expressionFooter(preview)).toContain('as <name>')
		// Nothing to save yet, so nothing to say about saving.
		expect(expressionFooter({ ...preview, result: null })).toBeNull()
		// Already naming it, and the name is fine — the row says the rest.
		expect(expressionFooter({ ...preview, saveAs: { name: 'runway', problem: null } })).toBeNull()
	})

	it('offers to forget a question the user saved, when the line is just its name', () => {
		const items = rows({ ...preview, savedName: 'runway' })
		expect(items.at(2)).toMatchObject({ action: 'forget', name: 'runway' })
	})

	it('offers the vocabulary below the answer, each as the whole query it would produce', () => {
		const items = rows(preview)
		expect(items[2]).toMatchObject({
			kind: 'complete',
			title: 'page',
			hint: 'everything on this board',
			query: '= sum price page',
			group: EXPRESSION_GROUP,
		})
	})

	it('shows only the vocabulary while the question is still half-typed', () => {
		// No answer yet is the normal state of an expression, and the words to finish it are exactly
		// what is useful then — so the menu must not go blank waiting for a complete question.
		const items = rows({ ...preview, result: null })
		expect(items.every((item) => item.kind === 'complete')).toBe(true)
		expect(items).toHaveLength(1)
	})

	it('never offers boards or commands — asking is not navigating', () => {
		expect(rows({ result: null, explicit: '', completions: [] })).toEqual([])
	})

	it('says what an empty list means, per mode', () => {
		expect(emptyMessage('expression', false)).toBe('Open a board to ask it a question')
		// Not "No matches", which would sound like the board came up empty rather than the question
		// being unreadable.
		expect(emptyMessage('expression', true)).toBe('Not a question this board can answer')
	})
})

describe('splitSaveClause', () => {
	it('splits the question from the name to file it under', () => {
		expect(splitSaveClause('sum cash page as runway')).toEqual({
			question: 'sum cash page',
			saveAs: 'runway',
		})
	})

	it('splits on the last “as”, so a question containing the word survives', () => {
		expect(splitSaveClause('sum as page as runway')).toEqual({
			question: 'sum as page',
			saveAs: 'runway',
		})
	})

	it('leaves a line with no name alone', () => {
		expect(splitSaveClause('sum cash page')).toEqual({ question: 'sum cash page', saveAs: null })
		// Nothing in front of it, so there is no question to name.
		expect(splitSaveClause('as runway')).toEqual({ question: 'as runway', saveAs: null })
	})

	it('reports a half-typed name as empty rather than as absent', () => {
		// The difference decides whether the footer teaches the clause or reports the empty name.
		expect(splitSaveClause('sum cash page as ')).toEqual({ question: 'sum cash page', saveAs: '' })
	})
})

describe('drill-in pages', () => {
	// Deliberately shaped like a real operation: a closed set, a free-text value, an optional the
	// palette must not ask for, and a confirmation.
	const op = defineOperation({
		id: 'test.thing',
		title: 'Make a thing',
		description: 'Makes a thing.',
		params: {
			kind: {
				type: 'string',
				description: 'What kind of thing.',
				required: true,
				choices: ['note', 'table'],
			},
			name: { type: 'string', description: 'What to call it.', required: true },
			colour: { type: 'string', description: 'Optional colour.' },
		},
		run: async () => ({ ok: true, data: null }),
	})

	const opening = command({ id: 'test.thing', title: 'Make a thing' })

	it('opens one page per required parameter, in declaration order, and skips the optional', () => {
		const drill = beginDrillIn(opening, op)
		expect(drill?.params.map((param) => param.name)).toEqual(['kind', 'name'])
		expect(currentParam(drill!)?.name).toBe('kind')
	})

	it('does not open at all for a command with nothing to ask', () => {
		const plain = defineOperation({
			id: 'test.plain',
			title: 'Plain',
			description: 'd',
			params: {},
			run: async () => ({ ok: true, data: null }),
		})
		// `null` is the signal to run it as an ordinary command rather than open an empty page.
		expect(beginDrillIn(command({ id: 'test.plain' }), plain)).toBeNull()
	})

	it('renders a closed set as rows, filtered by what has been typed', () => {
		const drill = beginDrillIn(opening, op)!
		expect(drillInItems(drill, '').map((i) => i.title)).toEqual(['note', 'table'])
		expect(drillInItems(drill, 'tab').map((i) => i.title)).toEqual(['table'])
	})

	it('renders a free-text parameter as one row carrying what was typed, and nothing when empty', () => {
		const drill = answerDrillIn(beginDrillIn(opening, op)!, 'note')
		expect(drillInItems(drill, '')).toEqual([])
		// The prompt, not "No matches" — an unanswered field is not a failed search.
		expect(drillInEmptyMessage(drill)).toBe('What to call it.')
		expect(drillInItems(drill, 'Shopping')).toMatchObject([
			{ kind: 'arg', title: 'Shopping', value: 'Shopping' },
		])
	})

	it('collects answers positionally and hands over only the required arguments', () => {
		let drill = beginDrillIn(opening, op)!
		expect(isComplete(drill)).toBe(false)
		drill = answerDrillIn(drill, 'note')
		drill = answerDrillIn(drill, 'Shopping')
		expect(isComplete(drill)).toBe(true)
		// No `colour`: an optional the user was never asked for must arrive as absent, not as ''.
		expect(drillInArgs(drill)).toEqual({ kind: 'note', name: 'Shopping' })
	})

	it('goes back a page at a time, then reports that there is nowhere left to go', () => {
		const drill = answerDrillIn(beginDrillIn(opening, op)!, 'note')
		const back = popDrillIn(drill)
		expect(back?.answers).toEqual([])
		expect(currentParam(back!)?.name).toBe('kind')
		// `null` means "leave the drill-in" — the caller decides whether that is the command list or
		// closing the palette, which is what makes Escape and Backspace one rule.
		expect(popDrillIn(back!)).toBeNull()
	})

	it('shows the answers so far, not the parameter names', () => {
		const drill = answerDrillIn(beginDrillIn(opening, op)!, 'note')
		expect(drillInCrumbs(drill)).toEqual(['Make a thing', 'note'])
	})

	it('offers a boolean as two rows, unfiltered', () => {
		const confirmOp = defineOperation({
			id: 'test.delete',
			title: 'Delete it',
			description: 'd',
			params: { confirm: { type: 'boolean', description: 'Really?', required: true } },
			run: async () => ({ ok: true, data: null }),
		})
		const drill = beginDrillIn(command({ id: 'test.delete' }), confirmOp)!
		// Not filtered: typing "y" must not be able to empty the list down to "No".
		expect(drillInItems(drill, 'y')).toMatchObject([
			{ title: 'Yes', value: true },
			{ title: 'No', value: false },
		])
	})

	it('coerces a number field, and offers nothing for something that is not one', () => {
		const numberOp = defineOperation({
			id: 'test.size',
			title: 'Size',
			description: 'd',
			params: { width: { type: 'number', description: 'How wide.', required: true } },
			run: async () => ({ ok: true, data: null }),
		})
		const drill = beginDrillIn(command({ id: 'test.size' }), numberOp)!
		expect(drillInItems(drill, '240')).toMatchObject([{ value: 240 }])
		expect(drillInItems(drill, 'wide')).toEqual([])
	})

	it('prefers a runtime set over a static one', () => {
		const liveOp = defineOperation({
			id: 'test.live',
			title: 'Live',
			description: 'd',
			params: {
				pick: {
					type: 'string',
					description: 'p',
					required: true,
					choices: ['stale'],
					liveChoices: () => ['fresh'],
				},
			},
			run: async () => ({ ok: true, data: null }),
		})
		const drill = beginDrillIn(command({ id: 'test.live' }), liveOp)!
		expect(drillInItems(drill, '').map((i) => i.title)).toEqual(['fresh'])
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
