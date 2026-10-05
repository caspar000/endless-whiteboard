import type { TLRichText } from '@tldraw/tlschema'

/**
 * The text of a rich-text document (TipTap/ProseMirror JSON, as boards store it since tldraw 3.10),
 * without its formatting: text nodes joined, one line per block.
 *
 * The 2023 shapes held plain strings; until the fork edits rich text (docs/fork-parity.md D1, E2) this
 * is how they read what boards hold.
 */
export function richTextToPlainText(richText: TLRichText | undefined | null): string {
	if (!richText) return ''
	const lines: string[] = []
	let line = ''
	const walk = (node: { type?: string; text?: string; content?: unknown[] }) => {
		if (typeof node.text === 'string') line += node.text
		if (node.type === 'hardBreak') line += '\n'
		for (const child of (node.content ?? []) as (typeof node)[]) walk(child)
		if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'codeBlock') {
			lines.push(line)
			line = ''
		}
	}
	walk(richText as unknown as Parameters<typeof walk>[0])
	if (line) lines.push(line)
	return lines.join('\n')
}
