import { richTextToPlainText, type TLRichText } from '@lifeboard/canvas'

type Block = { type?: string; content?: Block[] }

/** The note's title: its first line, when that line is a heading. Most notes have none (Q3). */
export function titleOf(richText: TLRichText): string | null {
	const first = (richText as unknown as Block).content?.[0]
	if (first?.type !== 'heading') return null
	return richTextToPlainText(first as unknown as TLRichText).trim() || null
}

/** What to call a note in lists, search and the graph: its title, or else its first line. */
export function nameOf(richText: TLRichText): string {
	return titleOf(richText) ?? richTextToPlainText(richText).split('\n').find((line) => line.trim())?.trim() ?? ''
}
