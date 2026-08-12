import { indentMore, indentLess } from '@codemirror/commands'
import { type ChangeSpec, type Extension, Prec } from '@codemirror/state'
import { keymap, type Command, type EditorView } from '@codemirror/view'
import { indentLine, toggleInline, toggleLinePrefix, type LineEdit } from './lineEdits'
import { decideEnter, parseContinuation } from './listContinuation'

/**
 * Everything the editor binds a key to.
 *
 * All of it drives the pure functions in `lineEdits.ts`, `listContinuation.ts` and `tasks.ts`, which have
 * their own tests — a Tab that mishandles a selection or a bold that loses the caret is caught there
 * rather than by feel. This module is the thin layer that reads CodeMirror's state, calls one of them, and
 * dispatches the result.
 *
 * Registered at `Prec.highest` so it beats CodeMirror's defaults: `defaultKeymap` binds Enter to a plain
 * newline and Tab to focus movement, neither of which is right in a note.
 */

/**
 * Enter: continue the list, or leave it.
 *
 * Two behaviours, both from `decideEnter`. Continuing prefills the next marker, which is what makes typing
 * a checklist bearable. Leaving inserts a **blank line**, and that detail is the reason this is ours: a
 * single newline makes the next paragraph a *lazy continuation* of the last item, so it renders indented
 * inside the bullet. That is exactly the bug that ruled out the editor library we tried first.
 */
const onEnter: Command = (view) => {
	const { state } = view
	const range = state.selection.main
	if (!range.empty) return false

	const line = state.doc.lineAt(range.head)
	const outcome = decideEnter(line.text, range.head - line.from)

	if (outcome.kind === 'exitList') {
		// Replacing the marker *with* a newline is what leaves the blank line behind: the marker's line
		// becomes empty and the caret lands on a fresh one after it.
		view.dispatch({
			changes: { from: line.from, to: line.to, insert: outcome.insert },
			selection: { anchor: line.from + outcome.insert.length },
			userEvent: 'input.type',
		})
		return true
	}

	view.dispatch({
		changes: { from: range.head, insert: outcome.text },
		selection: { anchor: range.head + outcome.text.length },
		userEvent: 'input.type',
	})
	return true
}

/**
 * Tab / Shift+Tab: nest and un-nest.
 *
 * In a note the canvas has nothing to tab *to*, and every outliner binds Tab this way. A multi-line
 * selection defers to CodeMirror's own `indentMore`/`indentLess`, which already handle a range of lines
 * correctly — the single-line path is ours only because it has to leave the caret on the same character
 * rather than at the indentation.
 */
function indentCommand(direction: 1 | -1): Command {
	return (view) => {
		const { state } = view
		const range = state.selection.main
		const startLine = state.doc.lineAt(range.from)
		if (startLine.number !== state.doc.lineAt(range.to).number) {
			return direction === 1 ? indentMore(view) : indentLess(view)
		}

		const edited = indentLine(
			{
				text: startLine.text,
				selStart: range.from - startLine.from,
				selEnd: range.to - startLine.from,
			},
			direction
		)
		// Nothing to outdent — don't spend an undo entry, and don't let focus escape either.
		if (!edited) return true

		view.dispatch({
			changes: { from: startLine.from, to: startLine.to, insert: edited.text },
			selection: {
				anchor: startLine.from + edited.selStart,
				head: startLine.from + edited.selEnd,
			},
			userEvent: 'input.indent',
		})
		return true
	}
}

/**
 * Emphasis, over the selection.
 *
 * `toggleInline` is handed the *whole document* with absolute offsets, because a selection can now span
 * lines. That is safe: the function only inserts or removes markers at the selection's two ends, and its
 * word-under-caret fallback stops at whitespace, which newlines are.
 */
function inlineCommand(marker: string): Command {
	return (view) => {
		const { state } = view
		const range = state.selection.main
		const edit: LineEdit = {
			text: state.doc.toString(),
			selStart: range.from,
			selEnd: range.to,
		}
		const next = toggleInline(edit, marker)
		view.dispatch({
			changes: { from: 0, to: state.doc.length, insert: next.text },
			selection: { anchor: next.selStart, head: next.selEnd },
			userEvent: 'input.format',
		})
		return true
	}
}

/**
 * List and quote markers, over every line the selection touches.
 *
 * Applied to the whole selected range rather than just the caret's line: turning six lines into a
 * checklist in one press is the obvious thing to want, and is only expressible now that a selection can
 * span lines at all.
 */
function linePrefixCommand(prefix: '- ' | '- [ ] ' | '1. ' | '> '): Command {
	return (view) => {
		const { state } = view
		const range = state.selection.main
		const first = state.doc.lineAt(range.from).number
		const last = state.doc.lineAt(range.to).number
		const caretLine = state.doc.lineAt(range.head).number

		const changes: ChangeSpec[] = []
		let caret = range.head
		for (let n = first; n <= last; n++) {
			const line = state.doc.line(n)
			const local = clamp(range.head - line.from, 0, line.length)
			const next = toggleLinePrefix({ text: line.text, selStart: local, selEnd: local }, prefix)
			if (next.text === line.text) continue
			changes.push({ from: line.from, to: line.to, insert: next.text })
			if (n === caretLine) caret = line.from + next.selStart
		}
		if (!changes.length) return true

		view.dispatch({ changes, selection: { anchor: caret }, userEvent: 'input.format' })
		return true
	}
}

/** ⌘Enter on a task line ticks it; anywhere else it means "done editing". */
function toggleTaskOrExit(onExit: () => void): Command {
	return (view) => {
		const { state } = view
		const line = state.doc.lineAt(state.selection.main.head)
		const marker = /^(\s*[-*+]\s+\[)([ xX])(\])/.exec(line.text)
		if (!marker) {
			onExit()
			return true
		}
		const at = line.from + marker[1]!.length
		view.dispatch({
			changes: { from: at, to: at + 1, insert: marker[2] === ' ' ? 'x' : ' ' },
			userEvent: 'input.toggleTask',
		})
		return true
	}
}

/**
 * Backspace just after a list marker removes the marker, rather than joining onto the previous line.
 *
 * What Notion and Obsidian both do, and the thing that makes a mistyped list easy to undo: the marker is
 * the nearest thing to the caret, so it is what a delete should take.
 */
const onBackspace: Command = (view) => {
	const { state } = view
	const range = state.selection.main
	if (!range.empty) return false

	const line = state.doc.lineAt(range.head)
	const continuation = parseContinuation(line.text)
	if (!continuation) return false
	// Only when the caret sits exactly at the end of the marker.
	if (range.head - line.from !== continuation.prefix.length) return false

	const indent = /^[ \t]*/.exec(continuation.prefix)![0]
	view.dispatch({
		changes: { from: line.from + indent.length, to: range.head },
		selection: { anchor: line.from + indent.length },
		userEvent: 'delete.backward',
	})
	return true
}

function clamp(n: number, min: number, max: number): number {
	return Math.max(min, Math.min(n, max))
}

export function editingKeymap(onExit: () => void): Extension {
	return Prec.highest(
		keymap.of([
			// Escape is *not* here: it has to be claimed before CodeMirror sees it, so it lives in a
			// capture-phase listener in `NoteEditor`. See the note there.
			{ key: 'Mod-Enter', run: toggleTaskOrExit(onExit) },
			{ key: 'Enter', run: onEnter },
			{ key: 'Backspace', run: onBackspace },
			{ key: 'Tab', run: indentCommand(1) },
			{ key: 'Shift-Tab', run: indentCommand(-1) },
			{ key: 'Mod-b', run: inlineCommand('**') },
			{ key: 'Mod-i', run: inlineCommand('*') },
			{ key: 'Mod-e', run: inlineCommand('`') },
			{ key: 'Mod-Shift-x', run: inlineCommand('~~') },
			{ key: 'Mod-Shift-7', run: linePrefixCommand('1. ') },
			{ key: 'Mod-Shift-8', run: linePrefixCommand('- ') },
			{ key: 'Mod-Shift-9', run: linePrefixCommand('- [ ] ') },
			{ key: 'Mod-Shift-.', run: linePrefixCommand('> ') },
		])
	)
}
