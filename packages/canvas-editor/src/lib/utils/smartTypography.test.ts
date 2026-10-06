import { Editor } from '@tiptap/core'
import { tipTapDefaultExtensions } from './richText'

/** Types `text` a character at a time, the way the browser hands it to the editor. */
function type(editor: Editor, text: string) {
	for (const ch of text) {
		const { view } = editor
		const { from, to } = view.state.selection
		const handled = view.someProp('handleTextInput', (f) => f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)))
		if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to))
	}
}

const typed = (text: string) => {
	const editor = new Editor({ extensions: tipTapDefaultExtensions, content: '<p></p>' })
	type(editor, text)
	const out = editor.getText()
	editor.destroy()
	return out
}

describe('smart typography (B7)', () => {
	it('curls quotes the right way round, apostrophes included', () => {
		expect(typed('"Hello," she said. It\'s \'fine\'.')).toBe('“Hello,” she said. It’s ‘fine’.')
	})

	it('turns -> <- and ... into arrows and an ellipsis', () => {
		expect(typed('a -> b <- c...')).toBe('a → b ← c…')
	})

	it('leaves an expression alone', () => {
		expect(typed('Total {sum "Price" -> x} "done"')).toBe('Total {sum "Price" -> x} “done”')
	})
})
