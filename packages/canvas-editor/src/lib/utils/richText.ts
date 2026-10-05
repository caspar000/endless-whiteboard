import { type Extensions, type JSONContent, generateHTML } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import type { TLRichText } from '@tldraw/tlschema'

/**
 * The text of a rich-text document (TipTap/ProseMirror JSON, as boards store it since tldraw 3.10),
 * without its formatting: text nodes joined, one line per block. For searching, hit-testing labels
 * and anything else that needs the words rather than the look.
 *
 * @public
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

/**
 * The TipTap extensions every label is edited and drawn with, unless the app passes its own through
 * `textOptions.tipTapConfig.extensions` (usually these plus more).
 *
 * StarterKit covers what boards hold: paragraphs, headings, lists, quotes, code, bold, italic,
 * strike, underline, links and line breaks. Its undo history stays on, for undo while typing; the
 * whole edit is one step in the board's own history.
 *
 * @public
 */
export const tipTapDefaultExtensions: Extensions = [
	StarterKit.configure({
		link: { openOnClick: false },
		dropcursor: false,
		gapcursor: false,
		trailingNode: false,
	}),
]

const htmlCache = new WeakMap<Extensions, WeakMap<TLRichText, string>>()

const escapeHtml = (text: string) =>
	text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * A rich-text document as HTML, for drawing a label that isn't being edited.
 *
 * A document holding something the extensions don't know (a node from an extension this app doesn't
 * load) is drawn as its plain text rather than not at all. The document itself is never changed.
 *
 * @public
 */
export function renderHtmlFromRichText(
	richText: TLRichText,
	extensions: Extensions = tipTapDefaultExtensions
): string {
	let byDoc = htmlCache.get(extensions)
	if (!byDoc) htmlCache.set(extensions, (byDoc = new WeakMap()))
	let html = byDoc.get(richText)
	if (html === undefined) {
		try {
			html = generateHTML(richText as JSONContent, extensions)
		} catch {
			html = richTextToPlainText(richText)
				.split('\n')
				.map((line) => `<p>${escapeHtml(line)}</p>`)
				.join('')
		}
		byDoc.set(richText, html)
	}
	return html
}

/** Whether a document has no text in it. @public */
export function isEmptyRichText(richText: TLRichText | undefined | null) {
	return richTextToPlainText(richText).trim().length === 0
}

type RichTextNode = { type?: string; text?: string; content?: RichTextNode[] }

/**
 * A document without trailing blank lines or trailing spaces, with its formatting kept. Returns the
 * same object when there was nothing to trim, so callers can skip the write.
 *
 * @public
 */
export function trimRichText(richText: TLRichText): TLRichText {
	const doc = structuredClone(richText) as unknown as RichTextNode
	const blocks = doc.content ?? []
	const isBlank = (node: RichTextNode) => richTextToPlainText(node as unknown as TLRichText).trim() === ''
	while (blocks.length > 1 && isBlank(blocks[blocks.length - 1]!)) blocks.pop()

	// Trailing spaces in the last text of the last block, however deep it sits (a list item's
	// paragraph, say).
	const trimEnd = (node: RichTextNode): void => {
		const children = node.content
		if (!children?.length) return
		const last = children[children.length - 1]!
		if (typeof last.text === 'string') {
			last.text = last.text.trimEnd()
			if (!last.text) {
				children.pop()
				trimEnd(node)
			}
		} else {
			trimEnd(last)
		}
	}
	trimEnd(doc)

	const trimmed = doc as unknown as TLRichText
	return JSON.stringify(trimmed) === JSON.stringify(richText) ? richText : trimmed
}
