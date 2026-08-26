import type {
	Command,
	CommandContext,
	NodeToolbarIcon,
	ParamSpec,
	RegisteredOperation,
} from '@lifeboard/node-kit'
import { requiredParams } from '@lifeboard/node-kit'
import type { TLShapeId } from 'tldraw'
import type { BoardMeta } from '../boards/boardIndex'

/**
 * What the palette shows, derived from the query, the command registry and the board index.
 *
 * Kept pure and DOM-free so the rules — which mode a query selects, what each mode offers, how
 * `when` gates a command — are unit-testable without rendering anything. `CommandPalette.tsx` is
 * then only presentation and key handling.
 */

/**
 * The VS Code split: navigation by default, commands behind a prefix. One surface, one keystroke;
 * the prefix is what tells the two apart, so ⌘K never has to mean two different things.
 */
export type PaletteMode = 'navigate' | 'commands' | 'find' | 'expression'

export const COMMAND_PREFIX = '>'
export const FIND_PREFIX = '@'
export const EXPRESSION_PREFIX = '='

/** Section titles. Also the groups `Command.group` uses, so a command lands where you'd expect. */
export const BOARDS_GROUP = 'Boards'
export const NAVIGATE_GROUP = 'Navigate'
export const INSERT_GROUP = 'Insert'
export const CANVAS_GROUP = 'Canvas'
export const APPEARANCE_GROUP = 'Appearance'
/**
 * Find mode's only section. Absent from `GROUP_ORDER` deliberately: the mode shows nothing else, so
 * there is no other section for it to be ordered against, and a rank there would be a fiction.
 */
export const FIND_GROUP = 'On this board'
/** Expression mode's sections: the answer, then the vocabulary for asking a better question. */
export const ANSWER_GROUP = 'Answer'
export const EXPRESSION_GROUP = 'Ask'
/** Where a command with no `group` goes. Always rendered last. */
export const OTHER_GROUP = 'Other'

/**
 * The sections that are about the app rather than about the board — and therefore the only ones whose
 * keys may fire while you are typing.
 *
 * ⌘K has to work over a note you are half-way through writing; `d` must type a `d`. The line between
 * those two is a rule about *groups*, so a new app-chrome command inherits it and a new canvas one
 * cannot accidentally claim a letter out from under the text editor.
 *
 * Not the same set navigate mode offers, which is deliberately narrower (Boards and Navigate only) —
 * that answers "where do I want to be", which Appearance is not an answer to.
 */
export const APP_CHROME_GROUPS: readonly string[] = [BOARDS_GROUP, NAVIGATE_GROUP, APPEARANCE_GROUP]

export function isAppChromeGroup(group: string | undefined): boolean {
	return group !== undefined && APP_CHROME_GROUPS.includes(group)
}

/**
 * Section order, declared rather than inherited from registration order.
 *
 * Registration order is an accident of module evaluation — the node registry's commands land before
 * the app's only because `App.tsx` imports `Board` before `appCommands` — so letting it decide the
 * layout means an unrelated import reshuffle silently reorders the palette, and it had already put
 * Undo and Delete at the very bottom. Roughly most-reached-for first, with the two sections that
 * mutate the board above the ones that move you around it.
 *
 * A group not listed here (an extension's own) keeps first-appearance order after these.
 */
const GROUP_ORDER: readonly string[] = [
	INSERT_GROUP,
	CANVAS_GROUP,
	BOARDS_GROUP,
	NAVIGATE_GROUP,
	APPEARANCE_GROUP,
]

/**
 * How many boards navigate mode offers. With an empty query these are the most recent ones (the
 * board index is already sorted by `updatedAt`), which is the answer for "take me back to what I
 * was doing"; anything more specific is a keystroke of filtering away.
 */
export const MAX_BOARDS = 8

/**
 * How many shapes find mode offers. Lower than a board can hold on purpose: past a dozen rows the
 * list stops being something you read and becomes something you scroll, and the answer to "where did
 * that thing go" is one more typed letter away.
 */
export const MAX_SHAPES = 12

/**
 * One shape on the open board, reduced to what find mode needs.
 *
 * Gathered by `findOnBoard.ts`, which owns the editor and the geometry; this module stays pure. The
 * order it arrives in is meaningful — nearest the middle of the view first — and is preserved below,
 * which is what keeps the distance maths out of here and testable over there.
 */
export interface BoardShapeRef {
	id: TLShapeId
	type: string
	/** Never empty: an unlabelled shape is dropped rather than listed as a blank row. */
	label: string
	icon?: NodeToolbarIcon
}

export type PaletteItem =
	| {
			kind: 'command'
			/** React key, stable across queries. */
			key: string
			title: string
			group: string
			command: Command
	  }
	| { kind: 'board'; key: string; title: string; group: string; board: BoardMeta }
	| {
			kind: 'shape'
			key: string
			title: string
			group: string
			shapeId: TLShapeId
			icon?: NodeToolbarIcon
	  }
	/*
	 * The answer to what has been typed, and what can be done with it. Discriminated a second time on
	 * `action` so each row carries exactly its own payload — a "forget" row has no answer in it, and a
	 * shape shared by all four would have to pretend otherwise with empty strings.
	 */
	| { kind: 'expression'; key: string; title: string; group: string; action: 'copy'; result: string }
	| {
			kind: 'expression'
			key: string
			title: string
			group: string
			action: 'drop'
			/** The question with its scope spelled out, which is what a dropped shape carries. */
			explicit: string
	  }
	| {
			kind: 'expression'
			key: string
			title: string
			group: string
			action: 'save'
			name: string
			body: string
	  }
	| { kind: 'expression'; key: string; title: string; group: string; action: 'forget'; name: string }
	/** A word from the `{…}` vocabulary. Rewrites the input rather than running anything. */
	| { kind: 'complete'; key: string; title: string; group: string; hint: string; query: string }
	/** One answer to the argument the current drill-in page is asking for. */
	| {
			kind: 'arg'
			key: string
			title: string
			group: string
			value: string | number | boolean
	  }

export interface ParsedQuery {
	mode: PaletteMode
	needle: string
}

export function parseQuery(raw: string): ParsedQuery {
	if (raw.startsWith(COMMAND_PREFIX)) {
		return { mode: 'commands', needle: raw.slice(COMMAND_PREFIX.length).trim() }
	}
	if (raw.startsWith(FIND_PREFIX)) {
		return { mode: 'find', needle: raw.slice(FIND_PREFIX.length).trim() }
	}
	if (raw.startsWith(EXPRESSION_PREFIX)) {
		return { mode: 'expression', needle: raw.slice(EXPRESSION_PREFIX.length).trim() }
	}
	return { mode: 'navigate', needle: raw.trim() }
}

/**
 * The expression as typed, **untrimmed** — unlike every other mode's needle.
 *
 * Trailing space is meaningful here and nowhere else: `= sum` is still choosing a verb, while
 * `= sum ` has settled on one and is asking what to sum. That distinction is the whole of what makes
 * the `{…}` menu positional (`suggest.ts`), and trimming it away would collapse the two.
 */
export function expressionBody(raw: string): string {
	return raw.startsWith(EXPRESSION_PREFIX) ? raw.slice(EXPRESSION_PREFIX.length) : ''
}

/**
 * Splits `sum cash page as runway` into the question and the name to file it under.
 *
 * Naming happens *in the line* rather than on a second page, and that is the whole design: the
 * palette stays one input with one way out, there is no half-finished state to be stranded in, and
 * the thing you type reads as the sentence you would have said. A page stack for this would have
 * been a mode whose only job was to collect one word.
 *
 * Split on the **last** ` as `, so a question that contains the word survives — and only when there
 * is a question in front of it, since `= as runway` names nothing.
 */
export function splitSaveClause(body: string): { question: string; saveAs: string | null } {
	const match = /^(.*\S)\s+as\s(.*)$/is.exec(body)
	if (!match) return { question: body, saveAs: null }
	return { question: match[1]!, saveAs: match[2]!.trim() }
}

/**
 * Narrows on what has been typed, case-insensitively, matching anywhere — the same rule (and the
 * same reasoning) as the `{…}` menu's filter in `suggest.ts`: titles are phrases, so someone
 * reaching for "Zoom to fit" types `fit` as readily as `zoom`, and a prefix match would offer them
 * nothing for it. No fuzzy scoring: the list is tens of items, not thousands.
 */
function matches(needle: string, ...haystacks: string[]): boolean {
	if (!needle) return true
	const lower = needle.toLowerCase()
	return haystacks.some((hay) => hay.toLowerCase().includes(lower))
}

function commandItem(command: Command, group: string): PaletteItem {
	return { kind: 'command', key: `command:${command.id}`, title: command.title, group, command }
}

/**
 * Collects items into `GROUP_ORDER`'s sections, each one contiguous so the renderer can put a single
 * header on it. The ungrouped bucket is forced last — it is the "everything else" pile, and a plugin
 * registering one loose command should not get to push the app's own sections down.
 *
 * Shared with the Help page, which groups the same commands under the same headings: two surfaces
 * over one table should not order it two different ways.
 */
export function groupInOrder<T extends { group: string }>(items: readonly T[]): T[] {
	const byGroup = new Map<string, T[]>()
	for (const item of items) {
		const existing = byGroup.get(item.group)
		if (existing) existing.push(item)
		else byGroup.set(item.group, [item])
	}
	const seen = [...byGroup.keys()]
	const rank = (group: string): number => {
		if (group === OTHER_GROUP) return Number.MAX_SAFE_INTEGER
		const declared = GROUP_ORDER.indexOf(group)
		return declared >= 0 ? declared : GROUP_ORDER.length + seen.indexOf(group)
	}
	return [...byGroup.entries()]
		.sort(([a], [b]) => rank(a) - rank(b))
		.flatMap(([, group]) => group)
}

export interface PaletteInput {
	query: string
	ctx: CommandContext
	boards: readonly BoardMeta[]
	/** Already enablement-filtered — pass `getVisibleCommands()`, never `getCommands()`. */
	commands: readonly Command[]
	/** The open board's shapes, nearest the middle of the view first. Only find mode reads them. */
	shapes?: readonly BoardShapeRef[]
	/** The evaluated expression and its completions. Only expression mode reads them. */
	expression?: ExpressionRows
}

/**
 * What `expressionMode.ts` works out — kept structural so this module still needs no editor. The
 * naming mirrors its `ExpressionPreview`; this is the part the rows are built from.
 */
export interface ExpressionRows {
	result: string | null
	explicit: string
	completions: readonly { label: string; detail: string; query: string }[]
	/** The name typed after `as`, if any, with why it cannot be used — or `null` if it can. */
	saveAs?: { name: string; problem: string | null } | null
	/** The saved question this one *is*, when the body is just its name. Offers to forget it. */
	savedName?: string | null
}

export function buildPaletteItems({
	query,
	ctx,
	boards,
	commands,
	shapes = [],
	expression,
}: PaletteInput): PaletteItem[] {
	const { mode, needle } = parseQuery(query)
	// Its own mode end to end: a board's contents are neither a place to go nor a verb to run, and
	// mixing them into either list would make both harder to read.
	if (mode === 'find') return findItems(needle, shapes)
	if (mode === 'expression') return expressionItems(expression)

	// `when` is the command's own availability predicate (Emacs' `interactive`), checked here for
	// display and again at invoke time — between the two, the active board can change.
	const available = commands.filter((command) => command.when?.(ctx) ?? true)
	const items: PaletteItem[] = []

	if (mode === 'navigate') {
		for (const board of boards) {
			if (items.length >= MAX_BOARDS) break
			if (matches(needle, board.name)) {
				items.push({
					kind: 'board',
					key: `board:${board.id}`,
					title: board.name,
					group: BOARDS_GROUP,
					board,
				})
			}
		}
	}

	for (const command of available) {
		const group = command.group ?? OTHER_GROUP
		// Navigate mode is "where do I want to be", so it offers only the groups that answer that —
		// a rule about groups rather than a list of ids, so a new navigation command needs no edit here.
		if (mode === 'navigate' && group !== BOARDS_GROUP && group !== NAVIGATE_GROUP) continue
		if (!matches(needle, command.title, group)) continue
		items.push(commandItem(command, group))
	}

	return groupInOrder(items)
}

/**
 * `@` — the shapes on the open board, by label.
 *
 * The incoming order is the ranking that needs the editor (nearest the middle of the view first), so
 * all that happens here is filtering and one promotion: a label that *starts* with what was typed
 * beats one that merely contains it. `Inbox` should not lose to `The inbox problem` just because the
 * second one happens to be nearer the camera.
 *
 * An empty needle degenerates correctly — everything matches, everything "starts with" the empty
 * string — so the bare `@` list is simply the nearest few, in order, with no branch for it.
 *
 * Not run through `groupInOrder`: there is one group, and sorting one section by rank would only
 * scramble the ordering above.
 */
function findItems(needle: string, shapes: readonly BoardShapeRef[]): PaletteItem[] {
	const lower = needle.toLowerCase()
	const hits = shapes.filter((shape) => matches(needle, shape.label))
	const leading = hits.filter((shape) => shape.label.toLowerCase().startsWith(lower))
	const rest = hits.filter((shape) => !shape.label.toLowerCase().startsWith(lower))
	return [...leading, ...rest].slice(0, MAX_SHAPES).map((shape) => ({
		kind: 'shape',
		key: `shape:${shape.id}`,
		title: shape.label,
		group: FIND_GROUP,
		shapeId: shape.id,
		...(shape.icon ? { icon: shape.icon } : {}),
	}))
}


/**
 * `=` — the answer on top, then the words that would make it a better question.
 *
 * Both sections at once, rather than an answer that appears only when the expression is complete.
 * Half-typed is the normal state of an expression, and a menu that vanishes the moment you are
 * mid-word is the one you stop trusting; the `{…}` menu already works this way, and this is the same
 * vocabulary rendered as rows.
 *
 * The answer is *two* rows because there are two things to do with it, and they are genuinely
 * different: copying takes the number somewhere else, while dropping it leaves the **question** on
 * the board (`explicit`, not `result`), where it keeps answering itself as the board changes. The
 * second is the one worth having and the one nobody would guess was there, so it is written out.
 */
function expressionItems(expression: ExpressionRows | undefined): PaletteItem[] {
	if (!expression) return []
	const items: PaletteItem[] = []

	if (expression.result !== null) {
		items.push({
			kind: 'expression',
			key: 'expression:copy',
			title: expression.result,
			group: ANSWER_GROUP,
			action: 'copy',
			result: expression.result,
		})
		items.push({
			kind: 'expression',
			key: 'expression:drop',
			title: `Put “{${expression.explicit}}” on the board — it keeps itself up to date`,
			group: ANSWER_GROUP,
			action: 'drop',
			explicit: expression.explicit,
		})
	}

	/*
	 * Only when the name can actually be used. A row that says why it cannot would be a row that does
	 * nothing when pressed — so the refusal goes in the footer instead (`expressionFooter`), where the
	 * hint that taught the `as` clause already lives, and every row in the list stays pressable.
	 */
	if (expression.saveAs && !expression.saveAs.problem) {
		items.push({
			kind: 'expression',
			key: 'expression:save',
			title: `Save this question as “${expression.saveAs.name}”`,
			group: ANSWER_GROUP,
			action: 'save',
			name: expression.saveAs.name,
			body: expression.explicit,
		})
	}

	if (expression.savedName) {
		items.push({
			kind: 'expression',
			key: 'expression:forget',
			title: `Forget “${expression.savedName}”`,
			group: ANSWER_GROUP,
			action: 'forget',
			name: expression.savedName,
		})
	}

	for (const completion of expression.completions) {
		items.push({
			kind: 'complete',
			key: `complete:${completion.query}`,
			title: completion.label,
			group: EXPRESSION_GROUP,
			hint: completion.detail,
			query: completion.query,
		})
	}

	return items
}

// ---------------------------------------------------------------------------
// Drill-in pages
// ---------------------------------------------------------------------------

/**
 * A command that needs arguments, part-way through being given them.
 *
 * The palette does not know what any of these arguments *mean*. It reads `requiredParams(op)` — the
 * operation's own declaration — and renders one page per entry from the `ParamSpec`: `choices` and
 * `liveChoices` become rows, a boolean becomes two, and anything else becomes a field. That is the
 * whole reason drill-in is built over operations rather than commands: `Command.run` takes no
 * arguments by design, while `Operation.params` is already a description of a form, written for a
 * reader deciding what to supply. Adding a parameterised operation adds its palette pages.
 *
 * Immutable, and answered positionally: `answers[i]` is the value for `params[i]`, so the current
 * page is always `params[answers.length]` and going back is dropping the last answer. No index to
 * keep in step with the array, and no partial record to reason about.
 */
export interface DrillIn {
	/** The operation being filled in. Also the id of the command that opened it — one name, two tables. */
	opId: string
	/** The command's title, for the breadcrumb: "Add image from a URL". */
	title: string
	params: readonly { name: string; spec: ParamSpec }[]
	answers: readonly (string | number | boolean)[]
}

/**
 * Opens a drill-in for a command, or `null` when the command has nothing to ask — in which case it
 * is an ordinary button and the caller should just run it.
 */
export function beginDrillIn(command: Command, op: RegisteredOperation): DrillIn | null {
	const params = requiredParams(op)
	if (!params.length) return null
	return { opId: op.id, title: command.title, params, answers: [] }
}

/** The parameter the current page is asking for, or `undefined` when every answer is in. */
export function currentParam(drill: DrillIn): { name: string; spec: ParamSpec } | undefined {
	return drill.params[drill.answers.length]
}

export function isComplete(drill: DrillIn): boolean {
	return drill.answers.length >= drill.params.length
}

export function answerDrillIn(drill: DrillIn, value: string | number | boolean): DrillIn {
	return { ...drill, answers: [...drill.answers, value] }
}

/**
 * Back one page, or `null` at the first — which means "leave the drill-in", not "close the palette".
 * Backspace on an empty input and Escape both land here, so there is one rule for going back.
 */
export function popDrillIn(drill: DrillIn): DrillIn | null {
	if (!drill.answers.length) return null
	return { ...drill, answers: drill.answers.slice(0, -1) }
}

/** What to hand `runOperation`. Only the required arguments: everything else keeps its default. */
export function drillInArgs(drill: DrillIn): Record<string, string | number | boolean> {
	const args: Record<string, string | number | boolean> = {}
	drill.params.forEach((param, index) => {
		const answer = drill.answers[index]
		if (answer !== undefined) args[param.name] = answer
	})
	return args
}

/**
 * The breadcrumb: the command, then each answer already given.
 *
 * Answers rather than parameter names, because the answers are what you need to see to know whether
 * to go back — "Add image from a URL › https://…" tells you where you are; "› url" does not.
 */
export function drillInCrumbs(drill: DrillIn): string[] {
	return [drill.title, ...drill.answers.map((answer) => String(answer))]
}

/**
 * The rows for the current page, generated from the parameter's own declaration.
 *
 * A free-text parameter gets one row carrying what has been typed, rather than no rows and a special
 * "Enter means the input" rule: every page then works the same way — arrow to a row, press Enter —
 * and the empty list keeps its one meaning, "nothing matches".
 */
export function drillInItems(drill: DrillIn, needle: string): PaletteItem[] {
	const param = currentParam(drill)
	if (!param) return []
	const { name, spec } = param
	const group = name

	const row = (value: string | number | boolean, title: string): PaletteItem => ({
		kind: 'arg',
		key: `arg:${drill.answers.length}:${String(value)}`,
		title,
		group,
		value,
	})

	// `liveChoices` before `choices`: a set only knowable at runtime is the more specific answer, and
	// a spec carrying both means the static list was the fallback.
	const choices = spec.liveChoices?.() ?? spec.choices
	if (choices) {
		return choices.filter((choice) => matches(needle, choice)).map((choice) => row(choice, choice))
	}

	if (spec.type === 'boolean') {
		// Not filtered: two rows are a decision, not a list to search, and typing "y" then Enter
		// should not be able to pick "No" because the filter emptied the list first.
		return [row(true, 'Yes'), row(false, 'No')]
	}

	const typed = needle.trim()
	if (!typed) return []
	if (spec.type === 'number') {
		const value = Number(typed)
		return Number.isFinite(value) ? [row(value, typed)] : []
	}
	return [row(typed, typed)]
}

/**
 * What an empty list should say.
 *
 * `@` with no board open gets its own sentence rather than "No matches", which would be a lie —
 * nothing was searched. A prefix that silently means nothing on some screens is worse than one that
 * says why.
 */
export function emptyMessage(mode: PaletteMode, hasEditor: boolean): string {
	if (mode === 'find' && !hasEditor) return 'Open a board to search what is on it'
	if (mode === 'expression' && !hasEditor) return 'Open a board to ask it a question'
	// An expression mid-word has no answer *and* nothing left to suggest — `= sum zzz` names no
	// property. Saying so beats "No matches", which sounds like the board came up empty.
	if (mode === 'expression') return 'Not a question this board can answer'
	return 'No matches'
}

/**
 * The line under the list in expression mode: why a name was refused, or how to save at all.
 *
 * A hint rather than a row, because it is neither an answer nor something to press — and because
 * `as` is the one part of this mode nobody would guess at, so it has to be visible while you are
 * looking at an answer and wondering what to do with it.
 */
export function expressionFooter(expression: ExpressionRows | undefined): string | null {
	if (!expression) return null
	if (expression.saveAs?.problem) return expression.saveAs.problem
	if (expression.saveAs) return null
	if (expression.result === null) return null
	return 'Type “as <name>” to save this question and use it anywhere'
}

/**
 * What an empty drill-in page should say — which is a prompt, not a failure. A field page with
 * nothing typed has no rows yet, and "No matches" would read as though the answer were wrong.
 */
export function drillInEmptyMessage(drill: DrillIn): string {
	const param = currentParam(drill)
	if (!param) return 'No matches'
	const { spec } = param
	if (spec.liveChoices?.() ?? spec.choices) return 'No matches'
	return spec.description
}

// ---------------------------------------------------------------------------
// Key binding display
// ---------------------------------------------------------------------------

const MAC_SYMBOLS: Record<string, string> = { cmd: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧' }
const PC_NAMES: Record<string, string> = { cmd: 'Ctrl', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' }

/**
 * Canonical modifier order, which is genuinely not the same on both platforms: macOS writes
 * Control-Option-Shift-Command (⇧⌘Z, as HelpPage already does), Windows writes Ctrl+Alt+Shift.
 */
const MAC_ORDER = ['ctrl', 'alt', 'shift', 'cmd']
const PC_ORDER = ['cmd', 'ctrl', 'alt', 'shift']
const MODIFIERS = new Set(MAC_ORDER)

/**
 * Renders a `Command.kbd` for display: `'cmd+shift+z'` → `⇧⌘Z` on a Mac, `Ctrl+Shift+Z` elsewhere.
 *
 * Modifiers are re-ordered rather than shown as written, so two commands that spell the same chord
 * differently still render identically — the palette and the Help page are the two places a user
 * compares bindings side by side.
 */
export function formatKbd(kbd: string, mac: boolean): string {
	const parts = kbd
		.split('+')
		.map((part) => part.trim().toLowerCase())
		.filter(Boolean)
	const keys = parts.filter((part) => !MODIFIERS.has(part)).map(keyLabel)
	if (mac) {
		const symbols = MAC_ORDER.filter((mod) => parts.includes(mod)).map((mod) => MAC_SYMBOLS[mod])
		return [...symbols, ...keys].join('')
	}
	// `cmd` and `ctrl` both spell Ctrl off the Mac, so a chord naming both must not read "Ctrl+Ctrl".
	const names = PC_ORDER.filter((mod) => parts.includes(mod)).map((mod) => PC_NAMES[mod])
	return [...new Set(names), ...keys].join('+')
}

function keyLabel(key: string): string {
	if (key.length === 1) return key.toUpperCase()
	return key.charAt(0).toUpperCase() + key.slice(1)
}

/**
 * Whether to draw ⌘ or Ctrl. `navigator.platform` is deprecated but is the only thing every browser
 * still answers honestly here — and being wrong costs a mislabelled keycap, not a broken shortcut,
 * since the palette accepts both modifiers regardless.
 */
export function isMacPlatform(): boolean {
	if (typeof navigator === 'undefined') return false
	return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)
}
