/**
 * The keymap for the line-based live-preview editor, as a pure decision function.
 *
 * Pure so it can be tested without a DOM or a tldraw editor. The interesting part is "which key, at
 * which caret position, in which line of how many, means what" — that deserves tests rather than
 * living inside an event handler where the IME guard is one forgotten condition away from breaking
 * text entry in Japanese, Chinese or Korean.
 */
export type NavigationAction =
	/** Let the textarea handle it, but stop it reaching the canvas as a tool shortcut. */
	| { kind: 'none' }
	/** Leave the editing session. */
	| { kind: 'exit' }
	/** Insert a line break at the caret. Enter does this in every kind of block, unconditionally. */
	| { kind: 'newline' }
	/** Join this line onto the previous one. */
	| { kind: 'joinBack' }
	/** Pull the next line onto this one. */
	| { kind: 'joinForward' }
	/** Move to an adjacent line, caret at the near edge. */
	| { kind: 'focusLine'; direction: -1 | 1; caret: 'start' | 'end' }
	/**
	 * Let the browser move the caret first; if it doesn't move we were on a visual edge and should
	 * change line. Used for ArrowUp/ArrowDown, because a long line wraps and "am I on the first visual
	 * line" cannot be answered without measuring line boxes.
	 */
	| { kind: 'maybeFocusLine'; direction: -1 | 1; caret: 'start' | 'end' }
	| { kind: 'undo' }
	| { kind: 'redo' }
	/** Tab / Shift+Tab: nest or un-nest the current line. */
	| { kind: 'indent'; direction: 1 | -1 }
	/** Wrap or unwrap the selection in an inline marker. */
	| { kind: 'inline'; marker: string }
	/** Tick or untick the current line's task checkbox. */
	| { kind: 'toggleTask' }
	/** Turn the current line into a list item of this kind, or back into plain text. */
	| { kind: 'linePrefix'; prefix: '- ' | '- [ ] ' | '1. ' | '> ' }

export interface KeyContext {
	key: string
	/** `metaKey || ctrlKey`. */
	mod: boolean
	shift: boolean
	/** True while an IME composition is in progress. */
	composing: boolean
	/** Caret is at offset 0 with nothing selected. */
	atLineStart: boolean
	/** Caret is at the end of the line with nothing selected. */
	atLineEnd: boolean
	index: number
	lineCount: number
	/** Whether the caret's line is a task item — decides what ⌘Enter means. */
	onTaskLine?: boolean
}

/**
 * After the browser has moved the caret for ArrowUp/ArrowDown, did it end up against the line's edge?
 *
 * This is how `maybeFocusLine` decides whether to change line, and the previous test — "did the caret
 * fail to move?" — was wrong in the most common case there is. A textarea holding a single visual row
 * moves the caret to offset 0 on ArrowUp rather than leaving it alone, so the first press did nothing
 * visible and you had to press again to leave the line.
 *
 * Landing on the edge is the reliable signal instead: a caret on the first visual row always lands on
 * offset 0, and one on any later row lands somewhere inside. (A caret at the very start of a *wrapped*
 * row 2 also lands on 0 and so changes line a press early — rare, and far less annoying than every
 * arrow press needing two.)
 */
export function crossedLineEdge(direction: -1 | 1, caret: number, length: number): boolean {
	return direction === -1 ? caret === 0 : caret === length
}

export function decideNavigation(ctx: KeyContext): NavigationAction {
	// An IME uses Enter and the arrows to pick candidates. Interpreting those as navigation is the
	// single easiest way to make the editor unusable for a large part of the world.
	if (ctx.composing) return { kind: 'none' }

	if (ctx.mod && (ctx.key === 'z' || ctx.key === 'Z')) {
		return ctx.shift ? { kind: 'redo' } : { kind: 'undo' }
	}

	// Inline formatting, on the shortcuts every editor uses for them.
	if (ctx.mod && !ctx.shift) {
		if (ctx.key === 'b' || ctx.key === 'B') return { kind: 'inline', marker: '**' }
		if (ctx.key === 'i' || ctx.key === 'I') return { kind: 'inline', marker: '*' }
		if (ctx.key === 'e' || ctx.key === 'E') return { kind: 'inline', marker: '`' }
	}
	if (ctx.mod && ctx.shift) {
		// ⌘⇧X is strikethrough in Notion and Bear; ⌘⇧7 / ⌘⇧8 are the ordered/bullet list shortcuts in
		// Notion, Google Docs and Word, so they are what people's hands already know.
		if (ctx.key === 'x' || ctx.key === 'X') return { kind: 'inline', marker: '~~' }
		if (ctx.key === '7' || ctx.key === '&') return { kind: 'linePrefix', prefix: '1. ' }
		if (ctx.key === '8' || ctx.key === '*') return { kind: 'linePrefix', prefix: '- ' }
		if (ctx.key === '9' || ctx.key === '(') return { kind: 'linePrefix', prefix: '- [ ] ' }
		if (ctx.key === '.' || ctx.key === '>') return { kind: 'linePrefix', prefix: '> ' }
	}

	// ⌘/Ctrl+Enter would be tldraw's "done editing", but on a task line ticking the box is what anyone
	// means by it — and Escape already exits, so nothing is lost.
	if (ctx.mod && ctx.key === 'Enter' && ctx.onTaskLine) return { kind: 'toggleTask' }

	// ⌘/Ctrl+Enter is tldraw's convention for "done editing".
	if (ctx.key === 'Escape' || (ctx.mod && ctx.key === 'Enter')) return { kind: 'exit' }

	// Tab nests rather than moving focus. In a note the canvas has nothing to tab *to*, and every
	// outliner binds Tab this way, so the default would be both useless and surprising.
	if (ctx.key === 'Tab') return { kind: 'indent', direction: ctx.shift ? -1 : 1 }

	// Unconditional: no split-vs-continue special cases by block type. A single newline renders as a
	// line break (MarkdownView enables `remark-breaks`), so the note visibly grows either way.
	if (ctx.key === 'Enter') return { kind: 'newline' }

	if (ctx.key === 'Backspace' && ctx.atLineStart && ctx.index > 0) return { kind: 'joinBack' }

	if (ctx.key === 'Delete' && ctx.atLineEnd && ctx.index < ctx.lineCount - 1) {
		return { kind: 'joinForward' }
	}

	if (ctx.key === 'ArrowLeft' && ctx.atLineStart && ctx.index > 0) {
		return { kind: 'focusLine', direction: -1, caret: 'end' }
	}

	if (ctx.key === 'ArrowRight' && ctx.atLineEnd && ctx.index < ctx.lineCount - 1) {
		return { kind: 'focusLine', direction: 1, caret: 'start' }
	}

	if (ctx.key === 'ArrowUp' && ctx.index > 0) {
		return { kind: 'maybeFocusLine', direction: -1, caret: 'end' }
	}

	if (ctx.key === 'ArrowDown' && ctx.index < ctx.lineCount - 1) {
		return { kind: 'maybeFocusLine', direction: 1, caret: 'start' }
	}

	return { kind: 'none' }
}
