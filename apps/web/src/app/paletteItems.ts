import type { Command, CommandContext } from '@lifeboard/node-kit'
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
export type PaletteMode = 'navigate' | 'commands'

export const COMMAND_PREFIX = '>'

/** Section titles. Also the groups `Command.group` uses, so a command lands where you'd expect. */
export const BOARDS_GROUP = 'Boards'
export const NAVIGATE_GROUP = 'Navigate'
export const INSERT_GROUP = 'Insert'
export const CANVAS_GROUP = 'Canvas'
export const APPEARANCE_GROUP = 'Appearance'
/** Where a command with no `group` goes. Always rendered last. */
export const OTHER_GROUP = 'Other'

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

export interface ParsedQuery {
	mode: PaletteMode
	needle: string
}

export function parseQuery(raw: string): ParsedQuery {
	if (raw.startsWith(COMMAND_PREFIX)) {
		return { mode: 'commands', needle: raw.slice(COMMAND_PREFIX.length).trim() }
	}
	return { mode: 'navigate', needle: raw.trim() }
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
}

export function buildPaletteItems({ query, ctx, boards, commands }: PaletteInput): PaletteItem[] {
	const { mode, needle } = parseQuery(query)
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
