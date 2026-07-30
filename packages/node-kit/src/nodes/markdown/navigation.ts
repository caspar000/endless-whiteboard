import { isMultiLineBlock } from './blocks'

/**
 * The keymap for the per-block editor, as a pure decision function.
 *
 * Pure so it can be unit-tested without a DOM or a tldraw editor — the interesting logic is "which
 * key, in which block type, at which caret position, means what", and that deserves tests rather than
 * being buried in an event handler.
 */
export type NavigationAction =
	| { kind: 'none' }
	/** Leave the editing session entirely. */
	| { kind: 'exit' }
	/** Split the current block at the caret; the new block becomes active. */
	| { kind: 'split' }
	/** Merge this block into the previous one. */
	| { kind: 'mergeBack' }
	/** Merge the next block into this one. */
	| { kind: 'mergeForward' }
	/** Move to an adjacent block, placing the caret at the near edge. */
	| { kind: 'focusBlock'; direction: -1 | 1; caret: 'start' | 'end' }
	/**
	 * The browser should handle the key first; if the caret does not move we were at a visual edge and
	 * should then move blocks. Used for ArrowUp/ArrowDown, where "am I on the first visual line" cannot
	 * be answered without measuring wrapped lines.
	 */
	| { kind: 'maybeFocusBlock'; direction: -1 | 1; caret: 'start' | 'end' }
	| { kind: 'undo' }
	| { kind: 'redo' }

export interface KeyContext {
	key: string
	/** `metaKey || ctrlKey`. */
	mod: boolean
	shift: boolean
	/** True while an IME composition is in progress. */
	composing: boolean
	/** Block type from mdast — `paragraph`, `heading`, `list`, `code`, … */
	blockType: string
	/** Caret offset within the block's text. */
	caret: number
	/** Length of the block's text. */
	length: number
	/** True when the selection is not collapsed. */
	hasSelection: boolean
	index: number
	blockCount: number
}

export function decideNavigation(ctx: KeyContext): NavigationAction {
	// Never interpret keys mid-composition: an IME uses Enter and the arrows to pick candidates, and
	// treating those as block navigation is the classic way to make an editor unusable in Japanese,
	// Chinese or Korean — or with an accent picker.
	if (ctx.composing) return { kind: 'none' }

	if (ctx.mod && (ctx.key === 'z' || ctx.key === 'Z')) {
		return ctx.shift ? { kind: 'redo' } : { kind: 'undo' }
	}

	if (ctx.key === 'Escape') return { kind: 'exit' }
	// ⌘/Ctrl+Enter is tldraw's convention for "done editing".
	if (ctx.mod && ctx.key === 'Enter') return { kind: 'exit' }

	if (ctx.key === 'Enter' && !ctx.shift) {
		// Inside a list, quote, fence or table a newline continues the construct, so let the textarea
		// insert it: the block stays one block, which is what the markdown means.
		if (isMultiLineBlock(ctx.blockType)) return { kind: 'none' }
		return { kind: 'split' }
	}

	if (ctx.key === 'Backspace' && !ctx.hasSelection && ctx.caret === 0 && ctx.index > 0) {
		return { kind: 'mergeBack' }
	}

	if (
		ctx.key === 'Delete' &&
		!ctx.hasSelection &&
		ctx.caret === ctx.length &&
		ctx.index < ctx.blockCount - 1
	) {
		return { kind: 'mergeForward' }
	}

	if (ctx.key === 'ArrowLeft' && !ctx.hasSelection && ctx.caret === 0 && ctx.index > 0) {
		return { kind: 'focusBlock', direction: -1, caret: 'end' }
	}

	if (
		ctx.key === 'ArrowRight' &&
		!ctx.hasSelection &&
		ctx.caret === ctx.length &&
		ctx.index < ctx.blockCount - 1
	) {
		return { kind: 'focusBlock', direction: 1, caret: 'start' }
	}

	// Vertical movement depends on *visual* lines, which wrap. Rather than compute line boxes, let the
	// browser move the caret and check afterwards whether it actually moved.
	if (ctx.key === 'ArrowUp' && !ctx.hasSelection && ctx.index > 0) {
		return { kind: 'maybeFocusBlock', direction: -1, caret: 'end' }
	}
	if (ctx.key === 'ArrowDown' && !ctx.hasSelection && ctx.index < ctx.blockCount - 1) {
		return { kind: 'maybeFocusBlock', direction: 1, caret: 'start' }
	}

	return { kind: 'none' }
}
