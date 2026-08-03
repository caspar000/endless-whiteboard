import { parseContinuation } from './listContinuation'

/**
 * Editing operations on the *one line* the caret is in.
 *
 * Pure functions over `(text, selection)` returning `(text, selection)`. Keeping them here rather than
 * in the event handler is what makes them testable — an indent that mishandles a selection, or a bold
 * toggle that loses the caret, is only obvious from the outside.
 *
 * The line is the unit because the editor's is: the live-preview editor puts a `<textarea>` on the
 * caret's line and renders the rest. Operations that need several lines at once (indenting a multi-line
 * selection, for instance) are not expressible in that architecture — see the note in `NoteEditor`.
 */
export interface LineEdit {
	text: string
	selStart: number
	selEnd: number
}

/** Two spaces per level: the width CommonMark needs for a nested bullet, and what most editors emit. */
export const INDENT = '  '

/**
 * Tab / Shift+Tab.
 *
 * On a list item this changes its *nesting*, which is what Tab means in every outliner. On a plain line
 * it inserts or removes indentation, so Tab still does something predictable rather than nothing.
 *
 * Returns `null` when there is nothing to do — outdenting a line with no indentation — so the caller can
 * skip the write and not spend an undo entry.
 */
export function indentLine(edit: LineEdit, direction: 1 | -1): LineEdit | null {
	const { text, selStart, selEnd } = edit
	const leading = /^[ \t]*/.exec(text)![0]

	if (direction === 1) {
		return {
			text: INDENT + text,
			// The caret keeps its place *in the text*, so typing continues where it was rather than
			// jumping to the new indentation.
			selStart: selStart + INDENT.length,
			selEnd: selEnd + INDENT.length,
		}
	}

	if (leading.length === 0) return null
	// Remove up to one indent's worth, tolerating an odd number of spaces or a tab: markdown in the wild
	// is indented inconsistently, and refusing to outdent it would be worse than normalising it.
	const removed = leading.startsWith(INDENT) ? INDENT.length : leading.startsWith('\t') ? 1 : 1
	return {
		text: text.slice(removed),
		selStart: Math.max(0, selStart - removed),
		selEnd: Math.max(0, selEnd - removed),
	}
}

/**
 * Wraps or unwraps the selection in an inline marker — `**` for bold, `*` for italic, `` ` `` for code.
 *
 * Toggling matters more than wrapping: ⌘B on already-bold text should un-bold it, and a version that
 * only ever wrapped would produce `****text****` on a second press.
 *
 * With nothing selected it wraps the *word* under the caret, which is what makes ⌘B usable without
 * selecting first. With no word either, it inserts the markers and puts the caret between them.
 */
export function toggleInline(edit: LineEdit, marker: string): LineEdit {
	const { text } = edit
	let { selStart, selEnd } = edit
	const ch = marker[0]!

	if (selStart === selEnd) {
		const word = wordAt(text, selStart)
		selStart = word.start
		selEnd = word.end
	}

	// Push any marker characters sitting at the selection's edges *outside* it, so "the user selected
	// `**bold**`" and "the user selected `bold`" become the same case rather than two branches.
	while (selEnd - selStart >= 2 && text[selStart] === ch && text[selEnd - 1] === ch) {
		selStart++
		selEnd--
	}

	// How many marker characters run up to the selection on each side. Counting the *run* rather than
	// testing for the marker is what keeps bold and italic from corrupting each other: `*` is a prefix
	// of `**`, so a naive `before.endsWith('*')` reads bold as italic and strips one asterisk, leaving
	// `*x*` where the user asked for `***x***`.
	const run = Math.min(trailingRun(text.slice(0, selStart), ch), leadingRun(text.slice(selEnd), ch))

	// Emphasis is counted, not matched: an odd run means italic is on, a run of two or more means bold
	// is on, and `***x***` is both. That is what makes ⌘I on bold text add italic instead of removing
	// the bold.
	const alreadyOn = marker.length === 1 ? run % 2 === 1 : run >= marker.length

	if (alreadyOn) {
		return {
			text:
				text.slice(0, selStart - marker.length) +
				text.slice(selStart, selEnd) +
				text.slice(selEnd + marker.length),
			selStart: selStart - marker.length,
			selEnd: selEnd - marker.length,
		}
	}

	return {
		text:
			text.slice(0, selStart) + marker + text.slice(selStart, selEnd) + marker + text.slice(selEnd),
		selStart: selStart + marker.length,
		selEnd: selEnd + marker.length,
	}
}

function trailingRun(text: string, ch: string): number {
	let n = 0
	while (n < text.length && text[text.length - 1 - n] === ch) n++
	return n
}

function leadingRun(text: string, ch: string): number {
	let n = 0
	while (n < text.length && text[n] === ch) n++
	return n
}

/** The word around an offset, used when ⌘B is pressed with nothing selected. */
function wordAt(text: string, offset: number): { start: number; end: number } {
	const isWord = (c: string | undefined) => c !== undefined && /[^\s]/.test(c)
	let start = offset
	let end = offset
	while (start > 0 && isWord(text[start - 1])) start--
	while (end < text.length && isWord(text[end])) end++
	return { start, end }
}

/**
 * Turns the line into a list item, or back into plain text.
 *
 * The markdown equivalent of a list button: pressing it on a paragraph makes it an item, pressing it on
 * an item removes the marker. Switching *between* kinds (bullet → task) replaces the marker rather than
 * nesting one inside the other.
 */
export function toggleLinePrefix(edit: LineEdit, prefix: '- ' | '- [ ] ' | '1. ' | '> '): LineEdit {
	const { text, selStart, selEnd } = edit
	const leading = /^[ \t]*/.exec(text)![0]
	const body = text.slice(leading.length)

	const existing = parseContinuation(body)
	const marker = existing ? existing.prefix.slice(/^[ \t]*/.exec(existing.prefix)![0].length) : ''

	// Same marker already there → remove it. Different marker → swap it. Nothing → add it.
	const replacement = marker === prefix ? '' : prefix
	const nextText = leading + replacement + body.slice(marker.length)
	const delta = replacement.length - marker.length

	return {
		text: nextText,
		selStart: Math.max(leading.length, selStart + delta),
		selEnd: Math.max(leading.length, selEnd + delta),
	}
}
