import { VIEW_MODES, type ViewMode } from './types'

/**
 * Whether the keyboard is being used to type text right now, wherever that is happening.
 *
 * The reader has text fields of its own — the tag names in the settings window — so "is this key
 * mine?" cannot be answered by looking only outside it. A focused *slider* or switch is not typing,
 * which is why the input types that cannot hold text are excluded: the settings panel is mostly
 * sliders, and a click on one must not kill the reader's keys until you click away again.
 */
const NON_TEXT_INPUTS = ['checkbox', 'radio', 'range', 'button', 'file', 'reset', 'submit', 'color']

export function typingNow(): boolean {
	const active = document.activeElement
	if (active instanceof HTMLInputElement) return !NON_TEXT_INPUTS.includes(active.type)
	if (active instanceof HTMLTextAreaElement) return true
	return active instanceof HTMLElement && active.isContentEditable
}

/**
 * Whether a keystroke belongs to something else on screen.
 *
 * The reader and its settings both listen for Escape on the *window*, in the capture phase, because
 * focus while reading may sit almost anywhere — the page, a control in the panel, the book's own
 * iframe — and a listener on any one of them would miss the others. That reach is also the hazard:
 * a surface opened *over* the reader has focus, and its Escape is not the reader's to read. Closing
 * the command palette should close the palette, not quietly dismiss the settings panel behind it.
 *
 * The test is "is something outside us taking typed input", which is what a palette, a rename box
 * and a search field all are, rather than a list of the app's own class names — a package has no
 * business knowing those, and the rule is the honest one anyway.
 */
export function typingElsewhere(container: Element): boolean {
	const active = document.activeElement
	// The common case while reading: focus is on the body or the canvas, and the key is ours.
	if (!active || container.contains(active)) return false
	return typingNow()
}

/* ------------------------------------------------------------------ where reader keys come from */

type KeyHandler = (event: KeyboardEvent) => void

const handlers = new Set<KeyHandler>()

function dispatch(event: KeyboardEvent): void {
	// Copied first: a handler is free to unsubscribe as it runs.
	for (const handler of [...handlers]) handler(event)
}

/**
 * Reader keys, from wherever the keystroke actually landed.
 *
 * A window listener is not enough, and that is not a corner case: a reflowable book renders in an
 * iframe per section, and clicking a paragraph — which is how you dismiss a selection — moves focus
 * into it. From then on every keystroke goes to *that* document and never reaches this one, so the
 * page-turn keys quietly stopped working after any click on the text. One handler list with two
 * sources fixes that for every reader key at once, and it forwards the *real* event rather than a
 * synthetic copy, so `preventDefault` still suppresses the iframe's own scrolling.
 *
 * Capture phase, like the Escape handlers: the app's dispatcher and tldraw both listen further down,
 * and a key the reader claims is a key they must not also see.
 */
export function subscribeToReaderKeys(handler: KeyHandler): () => void {
	handlers.add(handler)
	if (handlers.size === 1) window.addEventListener('keydown', dispatch, { capture: true })
	return () => {
		handlers.delete(handler)
		if (handlers.size === 0) window.removeEventListener('keydown', dispatch, { capture: true })
	}
}

/**
 * Also read this document's keys — a book section's iframe, handed over as it loads.
 *
 * Nothing to unsubscribe: the document is discarded with the frame that held it, and the listener
 * goes with it. Between sections there is briefly none, which is correct — a document that is gone
 * has no keys to report.
 */
export function readKeysFrom(doc: Document): void {
	doc.addEventListener('keydown', dispatch, { capture: true })
}

/* ---------------------------------------------------------------------- what the bar's keys are */

/**
 * What a key asks the reader's chrome for. Resolved by the overlay rather than here, because every
 * one of these is a *toggle* and the state being toggled is the overlay's.
 */
export type ReaderHotkey =
	| { kind: 'contents' }
	| { kind: 'view'; mode: ViewMode }
	| { kind: 'clipRegion' }
	| { kind: 'clipPage' }
	| { kind: 'settings' }

/**
 * The chords, as they are written where they are offered — the bar's tooltips and the help page.
 *
 * Single letters, unmodified, because the reader is a full-screen surface with no canvas keys behind
 * it and no text to type: the whole keyboard is free, and a reading key that needed ⌘ would be worse
 * for no reason. The layout choices get the digits instead of a letter each, in the order the three
 * buttons sit in — `viewModeKey` derives them from that order so the two cannot drift apart.
 */
export const READER_HOTKEYS = {
	contents: 'T',
	clipRegion: 'C',
	clipPage: '⇧C',
	settings: ',',
} as const

/** The digit that picks a layout: the position of its button in the bar. */
export function viewModeKey(mode: ViewMode): string {
	return String(VIEW_MODES.indexOf(mode) + 1)
}

/**
 * The key that was pressed, as something the bar does — or null for one that is not ours.
 *
 * Every modifier disqualifies a chord: ⌘C in a PDF is a copy, ⌘K is the palette, and a reader that
 * clipped a page whenever you tried to copy a sentence would be indefensible. Shift is the one
 * exception, and only where it means "the bigger version of this" — ⇧C clips the whole page where C
 * clips a region of it.
 */
export function readerHotkey(event: {
	key: string
	metaKey: boolean
	ctrlKey: boolean
	altKey: boolean
	shiftKey: boolean
}): ReaderHotkey | null {
	if (event.metaKey || event.ctrlKey || event.altKey) return null
	const key = event.key.toLowerCase()

	const mode = VIEW_MODES[Number(key) - 1]
	if (mode && !event.shiftKey) return { kind: 'view', mode }

	switch (key) {
		case 't':
			return event.shiftKey ? null : { kind: 'contents' }
		case 'c':
			return { kind: event.shiftKey ? 'clipPage' : 'clipRegion' }
		case ',':
			return event.shiftKey ? null : { kind: 'settings' }
		default:
			return null
	}
}
