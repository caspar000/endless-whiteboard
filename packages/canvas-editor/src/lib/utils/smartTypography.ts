import { Extension, InputRule } from '@tiptap/core'

/**
 * Typography as you type in a label (docs/fork-parity.md B7): straight quotes turn curly, the right
 * way round, and `->`, `<-` and `...` become →, ← and …. Backspace straight after takes it back.
 *
 * Not inside an inline expression (`{…}`), whose quotes are its own syntax, and not in code.
 *
 * @public
 */
export const SmartTypography = Extension.create({
	name: 'smartTypography',
	addInputRules() {
		return [
			replace(/->$/, () => '→'),
			replace(/<-$/, () => '←'),
			replace(/\.\.\.$/, () => '…'),
			// A quote after nothing, a space or an opening bracket opens; anywhere else it closes (and
			// a single one is an apostrophe).
			replace(/(^|[\s\S])"$/, ([, before = '']) => before + (opens(before) ? '“' : '”')),
			replace(/(^|[\s\S])'$/, ([, before = '']) => before + (opens(before) ? '‘' : '’')),
		]
	},
})

const opens = (before: string) => before === '' || /[\s([{“‘—–-]/.test(before)

/** Whether the cursor is inside an expression: a `{` with no `}` after it. */
const inExpression = (text: string) => text.lastIndexOf('{') > text.lastIndexOf('}')

function replace(pattern: RegExp, to: (match: RegExpExecArray) => string): InputRule {
	return new InputRule({
		find: (text) => {
			if (inExpression(text)) return null
			const match = pattern.exec(text)
			return match ? { index: match.index, text: match[0], data: { to: to(match) } } : null
		},
		handler: ({ state, range, match }) => {
			// Code keeps what was typed.
			if (state.selection.$from.marks().some((mark) => mark.type.name === 'code')) return null
			if (state.selection.$from.parent.type.spec.code) return null
			state.tr.insertText(String(match.data?.to ?? ''), range.from, range.to)
		},
	})
}
