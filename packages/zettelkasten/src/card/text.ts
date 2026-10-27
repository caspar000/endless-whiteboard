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

type Node = { type: string; attrs?: Record<string, unknown>; content?: Node[]; text?: string }

/**
 * A note's text from plain text, as an agent or an import writes it: a first line starting with `#`
 * is the title (a heading, Q3), every other line that has words is a paragraph, and blank lines only
 * separate them. `[[25a]]` links are plain text already.
 */
export function richTextFrom(text: string): TLRichText {
	const content: Node[] = []
	const lines = text.replace(/\r\n?/g, '\n').split('\n')
	lines.forEach((line, i) => {
		const title = i === 0 ? /^#{1,6}\s+(.*)$/.exec(line.trim()) : null
		if (title) {
			if (title[1]) content.push({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: title[1] }] })
			return
		}
		if (line.trim()) content.push({ type: 'paragraph', content: [{ type: 'text', text: line }] })
	})
	if (!content.length) content.push({ type: 'paragraph' })
	return { type: 'doc', content } as unknown as TLRichText
}

/** A note's text as plain text for an agent: the title as `# Title` on the first line, then the rest. */
export function plainOf(richText: TLRichText): string {
	const title = titleOf(richText)
	const lines = richTextToPlainText(richText).split('\n')
	if (title) lines[0] = `# ${title}`
	return lines.join('\n').trim()
}
