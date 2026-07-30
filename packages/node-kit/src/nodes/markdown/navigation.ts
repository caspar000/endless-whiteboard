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
}

export function decideNavigation(ctx: KeyContext): NavigationAction {
	// An IME uses Enter and the arrows to pick candidates. Interpreting those as navigation is the
	// single easiest way to make the editor unusable for a large part of the world.
	if (ctx.composing) return { kind: 'none' }

	if (ctx.mod && (ctx.key === 'z' || ctx.key === 'Z')) {
		return ctx.shift ? { kind: 'redo' } : { kind: 'undo' }
	}

	// ⌘/Ctrl+Enter is tldraw's convention for "done editing".
	if (ctx.key === 'Escape' || (ctx.mod && ctx.key === 'Enter')) return { kind: 'exit' }

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
