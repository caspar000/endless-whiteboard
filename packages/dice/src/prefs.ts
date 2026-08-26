import { DIE_KINDS, type DieKind } from './kinds'

/**
 * How the dice look, and where that choice lives.
 *
 * Deliberately **not** in the 3D chunk. `three/mesh.ts` is only loaded on the first throw, and Settings
 * has to be able to show and change these without pulling three.js in — so the preference lives here,
 * eagerly, and the renderer reads it. That also makes this the single source of truth rather than the
 * scene holding a copy that has to be kept in step.
 *
 * localStorage with a try/catch on both sides, as `app/canvasPrefs.tsx` does it: private-mode Safari
 * throws on write, and losing a colour across reloads is not worth a failure.
 */
export interface DicePrefs {
	/** One colour for the whole set. Ignored while `colourful` is on. */
	colour: string
	/** A colour per die kind instead of one for the set, the way a bought set arrives. */
	colourful: boolean
	/**
	 * Per-kind overrides, used only while `colourful` is on. A kind with no entry takes `DICE_PALETTE`.
	 *
	 * Sparse rather than a full record so the defaults can change without freezing whatever they happened
	 * to be the first time somebody opened Settings.
	 */
	kindColours: Partial<Record<DieKind, string>>
	/**
	 * The edge highlight — the line each face draws round itself, which together read as the die's
	 * wireframe.
	 *
	 * `'follow'` takes the numerals' colour, which is what a real die looks like. A hex string overrides
	 * it. `'off'` removes it.
	 */
	edges: 'follow' | 'off' | (string & {})
	/**
	 * Whether a roll leaves a card on the board.
	 *
	 * **Off**, which is the whole design of the tray: a roll is a moment, and throwing dice costs you
	 * nothing to tidy up afterwards. On, for the times you are keeping score — and then the total is a
	 * property, so a table can group and sum your rolls like anything else on the board.
	 */
	keepResults: boolean
}

/** Bone rather than white — a pure white die on white paper has no edges. */
export const DEFAULT_DICE_COLOUR = '#f2eee4'

export const DEFAULT_DICE_PREFS: DicePrefs = {
	colour: DEFAULT_DICE_COLOUR,
	colourful: false,
	kindColours: {},
	edges: 'follow',
	keepResults: false,
}

/**
 * The colours offered as swatches — **the app's own palette**, in the dock's order.
 *
 * These are tldraw's `solid` values, the same ten the pen's colour row offers, so a red die is the red
 * a red sticky is. Copied rather than read from `editor.getCurrentTheme()` because Settings has no
 * editor to ask, which is the one reason not to resolve them live; the light theme's values are used in
 * both themes deliberately, since a die is a physical object and does not repaint when the UI does.
 *
 * A picked set rather than a colour wheel: choosing a die's colour is a two-second decision and a hex
 * field is the wrong shape for it. The full editor is one click away behind **Advanced**.
 */
export const DICE_SWATCHES: readonly string[] = [
	DEFAULT_DICE_COLOUR,
	'#e03131',
	'#e16919',
	'#f1ac4b',
	'#099268',
	'#4ba1f1',
	'#4465e9',
	'#ae3ec9',
	'#e085f4',
	'#9fa8b2',
	'#1d1d1d',
]

/**
 * The colour each kind takes in colourful mode.
 *
 * The conventional set: the d20 amber, the d12 magenta, the d10 sky, the d8 green, the d6 red, the d4
 * yellow. The percentile die shares the d10's, because it *is* a second d10.
 */
export const DICE_PALETTE: Record<DieKind, string> = {
	d4: '#f1ac4b',
	d6: '#e03131',
	d8: '#099268',
	d10: '#4ba1f1',
	d12: '#ae3ec9',
	d20: '#e16919',
	// The percentile die is a second d10, so it starts *near* one — but it is settable on its own,
	// because somebody rolling both at once has every reason to want to tell them apart.
	d100: '#e085f4',
}

const KEY = 'lifeboard:dicePrefs'

let prefs: DicePrefs = load()
const listeners = new Set<() => void>()

function load(): DicePrefs {
	try {
		const raw = localStorage.getItem(KEY)
		if (!raw) return DEFAULT_DICE_PREFS
		const parsed: unknown = JSON.parse(raw)
		if (typeof parsed !== 'object' || parsed === null) return DEFAULT_DICE_PREFS
		const record = parsed as Partial<DicePrefs>
		return {
			colour: typeof record.colour === 'string' ? record.colour : DEFAULT_DICE_PREFS.colour,
			colourful: record.colourful === true,
			kindColours: readKindColours(record.kindColours),
			edges: typeof record.edges === 'string' ? record.edges : DEFAULT_DICE_PREFS.edges,
			keepResults: record.keepResults === true,
		}
	} catch {
		// Also the node path: the unit tests import this module without a DOM.
		return DEFAULT_DICE_PREFS
	}
}

/** Only the kinds we ship, only string values — a stored file is not a trusted input. */
function readKindColours(raw: unknown): Partial<Record<DieKind, string>> {
	if (typeof raw !== 'object' || raw === null) return {}
	const source = raw as Record<string, unknown>
	const out: Partial<Record<DieKind, string>> = {}
	for (const kind of DIE_KINDS) {
		const value = source[kind]
		if (typeof value === 'string') out[kind] = value
	}
	return out
}

/** A stable snapshot between changes, so it can be handed to `useSyncExternalStore`. */
export function getDicePrefs(): DicePrefs {
	return prefs
}

export function subscribeToDicePrefs(listener: () => void): () => void {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

export function setDicePrefs(patch: Partial<DicePrefs>): void {
	prefs = { ...prefs, ...patch }
	try {
		localStorage.setItem(KEY, JSON.stringify(prefs))
	} catch {
		// Private-mode Safari can throw on write; losing the preference across reloads is fine.
	}
	for (const listener of listeners) listener()
}

/** The body colour a given die is painted in, under the current preference. */
export function bodyColourFor(kind: DieKind): string {
	if (!prefs.colourful) return prefs.colour
	return prefs.kindColours[kind] ?? DICE_PALETTE[kind]
}

/** Sets one die's colour, or clears it back to the set's default with `null`. */
export function setKindColour(kind: DieKind, colour: string | null): void {
	const kindColours = { ...prefs.kindColours }
	if (colour === null) delete kindColours[kind]
	else kindColours[kind] = colour
	setDicePrefs({ kindColours })
}

/**
 * Ink that can be read on a given body colour.
 *
 * Not a preference, on purpose. A numeral is only ever printed *on* the body, so which of the two inks
 * to use is a property of the body rather than a third thing for someone to choose — and a dark die
 * with dark numbers is unreadable in a way no amount of choosing would fix.
 *
 * Relative luminance, sRGB-weighted, with the threshold where the two inks are about equally legible.
 */
export const DARK_INK = '#22222a'
export const LIGHT_INK = '#f6f4ef'

export function inkOn(body: string): string {
	const hex = body.replace('#', '')
	const channel = (at: number) => parseInt(hex.slice(at, at + 2), 16) / 255
	const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
	const luminance =
		0.2126 * linear(channel(0)) + 0.7152 * linear(channel(2)) + 0.0722 * linear(channel(4))
	return luminance > 0.45 ? DARK_INK : LIGHT_INK
}

/** The colour a die's edge highlight is drawn in, or `null` when it is switched off. */
export function edgeColourFor(kind: DieKind): string | null {
	if (prefs.edges === 'off') return null
	return prefs.edges === 'follow' ? inkOn(bodyColourFor(kind)) : prefs.edges
}

/** Every kind, for a preview that wants to show the set. */
export const PREVIEW_KINDS = DIE_KINDS
