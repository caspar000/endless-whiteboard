import { getVisibleCommands, subscribeToCommands } from './commands'

/**
 * What a key does — the user's answer, over the command table's default.
 *
 * `Command.kbd` was display-only until now: tldraw dispatched the canvas keys and the app owned ⌘K,
 * and the table merely *recorded* what the chords were. This is the layer that makes the table
 * authoritative, and it is deliberately the only place a chord is turned into a command id, so the
 * dispatcher, the Settings page and the Help page cannot disagree about what a key is bound to.
 *
 * Two vocabulary decisions, both inherited rather than invented:
 *
 * - **`cmd` means "the platform's accelerator".** It matches Meta *or* Control, which is how ⌘K has
 *   always behaved here and how `formatKbd` already renders it ("cmd and ctrl both spell Ctrl off the
 *   Mac"). One binding therefore works on both platforms, and `ctrl` is accepted as a spelling of the
 *   same modifier rather than as a fourth one.
 * - **A binding may hold alternates**, comma-separated, because tldraw's tool keys legitimately have
 *   two (`v,1` — a letter and a digit, so a hand never has to leave either side of the keyboard).
 */

/**
 * Canonical modifier order. Arbitrary but *fixed*, which is the only property that matters: two
 * spellings of one chord have to normalise to the same string or the map would hold both.
 */
const CHORD_ORDER = ['cmd', 'alt', 'shift'] as const

const MODIFIERS: Record<string, (typeof CHORD_ORDER)[number]> = {
	cmd: 'cmd',
	command: 'cmd',
	meta: 'cmd',
	// Collapsed onto `cmd` rather than kept apart: see the note above. A chord naming both is one
	// modifier named twice, which is exactly how `formatKbd` already reads it.
	ctrl: 'cmd',
	control: 'cmd',
	alt: 'alt',
	option: 'alt',
	opt: 'alt',
	shift: 'shift',
}

/**
 * Spellings of the same key. Short on purpose — it exists to reconcile what our table writes
 * (`backspace`) with what tldraw's writes (`⌫`) and what a browser reports (`ArrowUp`), not to be a
 * general keyboard database.
 */
const KEY_ALIASES: Record<string, string> = {
	'⌫': 'backspace',
	del: 'delete',
	esc: 'escape',
	return: 'enter',
	' ': 'space',
	spacebar: 'space',
	arrowup: 'up',
	arrowdown: 'down',
	arrowleft: 'left',
	arrowright: 'right',
}

/** One chord — `cmd+shift+z` — in canonical form, or `null` if there is no key in it. */
export function normalizeChord(chord: string): string | null {
	const parts = chord
		.split('+')
		.map((part) => part.trim().toLowerCase())
		.filter(Boolean)
	const mods = new Set<string>()
	let key: string | undefined
	for (const part of parts) {
		const modifier = MODIFIERS[part]
		if (modifier) {
			mods.add(modifier)
			continue
		}
		key = KEY_ALIASES[part] ?? part
	}
	if (!key) return null
	return [...CHORD_ORDER.filter((mod) => mods.has(mod)), key].join('+')
}

/** A `Command.kbd` as the chords it stands for: `'v,1'` → `['v', '1']`. */
export function parseKbd(kbd: string): string[] {
	return kbd
		.split(',')
		.map((chord) => normalizeChord(chord))
		.filter((chord): chord is string => chord !== null)
}

/**
 * The chord a keystroke is, or `null` for a keypress that is only a modifier.
 *
 * Digits are read off `event.code` rather than `event.key`, and that is not a detail: `shift+1`
 * arrives as `key: '!'`, so a table that writes `shift+1` — as ours does for Zoom to fit — would
 * never match. Letters stay on `event.key`, which is what keeps a Dvorak or AZERTY layout working.
 */
export function chordFromEvent(event: {
	key: string
	code?: string
	metaKey: boolean
	ctrlKey: boolean
	altKey: boolean
	shiftKey: boolean
}): string | null {
	const digit = /^Digit(\d)$/.exec(event.code ?? '')
	const raw = digit ? digit[1]! : event.key.toLowerCase()
	const key = KEY_ALIASES[raw] ?? raw
	if (key === 'meta' || key === 'control' || key === 'alt' || key === 'shift') return null
	const mods: string[] = []
	if (event.metaKey || event.ctrlKey) mods.push('cmd')
	if (event.altKey) mods.push('alt')
	if (event.shiftKey) mods.push('shift')
	return [...CHORD_ORDER.filter((mod) => mods.includes(mod)), key].join('+')
}

// ---------------------------------------------------------------------------
// The user's answer
// ---------------------------------------------------------------------------

/**
 * Command id → the chord (or chords) the user chose, or `null` for one they deliberately unbound.
 *
 * `null` and absent are different states and both are needed: absent means "I never touched this, use
 * the default", while `null` means "I want this key to do nothing". Collapsing them would make
 * unbinding impossible.
 */
export type UserBindings = Readonly<Record<string, string | null>>

let userBindings: UserBindings = {}

const listeners = new Set<() => void>()
let matchCache: Map<string, ChordMatch> | null = null

function invalidate(): void {
	matchCache = null
	for (const listener of listeners) listener()
}

// A registration or an extension toggle changes what is bound, so the keymap follows the table it is
// a view of — the same chaining `commands.ts` does off the node registry.
subscribeToCommands(invalidate)

export function subscribeToKeymap(listener: () => void): () => void {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

export function setUserBindings(next: UserBindings): void {
	userBindings = { ...next }
	invalidate()
}

export function getUserBindings(): UserBindings {
	return userBindings
}

/** Whether this command's binding is the user's rather than the table's default. */
export function hasUserBinding(commandId: string): boolean {
	return Object.hasOwn(userBindings, commandId)
}

/** The binding in force: the user's if they set one, otherwise the command's own `kbd`. */
export function bindingFor(commandId: string): string | null {
	if (Object.hasOwn(userBindings, commandId)) return userBindings[commandId] ?? null
	const command = getVisibleCommands().find((candidate) => candidate.id === commandId)
	return command?.kbd ?? null
}

/** The chords in force for a command, canonical and expanded. Empty when it is unbound. */
export function chordsFor(commandId: string): string[] {
	const binding = bindingFor(commandId)
	return binding ? parseKbd(binding) : []
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

export interface ChordMatch {
	/**
	 * The command to run — or `null` for a chord that is a command's *retired default*, which must be
	 * taken and then do nothing.
	 *
	 * That second state is what makes rebinding honest. tldraw still has its own binding for ⌘Z, and
	 * the app's listener runs in the capture phase — so if the user moves Undo to another chord, ⌘Z
	 * has to be *swallowed* rather than left to fall through, or the old key would keep working and
	 * the rebinding would look ignored.
	 */
	commandId: string | null
}

function buildMatches(): Map<string, ChordMatch> {
	const matches = new Map<string, ChordMatch>()
	const commands = getVisibleCommands()

	// Live bindings first, in registration order, so a conflict resolves the same way every time and
	// the winner is the one that was registered first rather than whichever came last.
	for (const command of commands) {
		for (const chord of chordsFor(command.id)) {
			if (!matches.has(chord)) matches.set(chord, { commandId: command.id })
		}
	}

	// Then the defaults that have been rebound away, claimed only where nothing live wants them.
	for (const command of commands) {
		if (!command.kbd || !hasUserBinding(command.id)) continue
		const live = new Set(chordsFor(command.id))
		for (const chord of parseKbd(command.kbd)) {
			if (live.has(chord) || matches.has(chord)) continue
			matches.set(chord, { commandId: null })
		}
	}

	return matches
}

/** What this chord does now, or `undefined` when the keymap does not claim it at all. */
export function matchChord(chord: string): ChordMatch | undefined {
	matchCache ??= buildMatches()
	return matchCache.get(chord)
}

/**
 * The other commands already bound to this chord — what Settings has to show rather than silently
 * resolve. A binding that quietly lost to another command is a key that does nothing for no visible
 * reason, which is the worst outcome available here.
 */
export function conflictsFor(chord: string, exceptCommandId?: string): string[] {
	const wanted = normalizeChord(chord)
	if (!wanted) return []
	return getVisibleCommands()
		.filter((command) => command.id !== exceptCommandId && chordsFor(command.id).includes(wanted))
		.map((command) => command.id)
}
