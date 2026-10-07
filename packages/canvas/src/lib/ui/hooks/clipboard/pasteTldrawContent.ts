import { Editor, TLContent, VecLike } from '@lifeboard/canvas-editor'

/**
 * When the clipboard has tldraw content, paste it into the scene.
 *
 * @param editor - The editor instance.
 * @param clipboard - The clipboard model.
 * @param point - The point at which to paste the text.
 * @internal
 */
export function pasteTldrawContent(editor: Editor, clipboard: TLContent, point?: VecLike) {
	const p = point ?? (editor.inputs.shiftKey ? editor.inputs.currentPagePoint : undefined)

	const content = beforePaste(editor, clipboard, p)
	if (!content) return

	editor.mark('paste')
	editor.putContentOntoCurrentPage(content, {
		point: p,
		select: true,
	})
}

/**
 * Pasted shapes as the app's `onBeforePasteFromClipboard` would have them (docs/fork-parity.md X2):
 * changed, as they were, or `null` for nothing to paste.
 *
 * @internal
 */
export function beforePaste(editor: Editor, content: TLContent, point?: VecLike): TLContent | null {
	const changed = editor.options.onBeforePasteFromClipboard?.({ editor, point }, content)
	if (changed === null) return null
	return changed ?? content
}
