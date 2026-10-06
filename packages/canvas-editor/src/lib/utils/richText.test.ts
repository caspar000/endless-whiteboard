import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getSchema, type JSONContent } from '@tiptap/core'
import { Node } from '@tiptap/pm/model'
import type { TLRichText } from '@tldraw/tlschema'
import {
	isEmptyRichText,
	renderHtmlFromRichText,
	richTextToPlainText,
	tipTapDefaultExtensions,
	trimRichText,
} from './richText'

const doc = (...content: object[]) => ({ type: 'doc', content }) as unknown as TLRichText
const p = (...content: object[]) => ({ type: 'paragraph', ...(content.length ? { content } : {}) })
const text = (value: string, ...marks: string[]) => ({
	type: 'text',
	text: value,
	...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}),
})
const list = (...items: string[]) => ({
	type: 'bulletList',
	content: items.map((item) => ({ type: 'listItem', content: [p(text(item))] })),
})

describe('richTextToPlainText', () => {
	it('joins text runs and puts each block on its own line', () => {
		expect(richTextToPlainText(doc(p(text('Rich '), text('label', 'bold')), list('first')))).toBe(
			'Rich label\nfirst'
		)
	})

	it('is empty for nothing', () => {
		expect(richTextToPlainText(undefined)).toBe('')
		expect(richTextToPlainText(doc(p()))).toBe('')
		expect(isEmptyRichText(doc(p(text('  '))))).toBe(true)
		expect(isEmptyRichText(doc(p(text('a'))))).toBe(false)
	})
})

describe('renderHtmlFromRichText', () => {
	it('draws formatting and lists as HTML', () => {
		const html = renderHtmlFromRichText(
			doc(p(text('a', 'bold'), text('b', 'italic'), text('c', 'code')), list('one', 'two'))
		)
		expect(html).toBe(
			'<p><strong>a</strong><em>b</em><code>c</code></p><ul><li><p>one</p></li><li><p>two</p></li></ul>'
		)
	})

	it('draws a highlight, and keeps the rest of the formatting with it', () => {
		// Before highlight was one of the extensions, one highlighted word made the whole label plain text.
		expect(renderHtmlFromRichText(doc(p(text('a', 'bold'), text('b', 'highlight'))))).toBe(
			'<p><strong>a</strong><mark>b</mark></p>'
		)
	})

	it('escapes text', () => {
		expect(renderHtmlFromRichText(doc(p(text('<b>&</b>'))))).toBe('<p>&lt;b&gt;&amp;&lt;/b&gt;</p>')
	})

	it('draws a document it cannot read as its plain text, without changing it', () => {
		const unknown = doc(p(text('kept')), { type: 'mystery', content: [p(text('<odd>'))] })
		const before = JSON.stringify(unknown)
		expect(renderHtmlFromRichText(unknown)).toBe('<p>kept</p><p>&lt;odd&gt;</p>')
		expect(JSON.stringify(unknown)).toBe(before)
	})

	it('reuses the HTML for the same document', () => {
		const richText = doc(p(text('same')))
		expect(renderHtmlFromRichText(richText)).toBe(renderHtmlFromRichText(richText))
	})
})

describe('trimRichText', () => {
	it('drops trailing blank lines and spaces, and keeps formatting', () => {
		const trimmed = trimRichText(doc(p(text('bold  ', 'bold')), p(), p(text(' '))))
		expect(trimmed).toEqual(doc(p(text('bold', 'bold'))))
	})

	it('trims inside the last list item', () => {
		expect(trimRichText(doc(list('one', 'two  ')))).toEqual(doc(list('one', 'two')))
	})

	it('returns the same document when there is nothing to trim', () => {
		const richText = doc(p(text('done')))
		expect(trimRichText(richText)).toBe(richText)
	})
})

describe('the default extensions', () => {
	// Every label on the reference boards (packages/canvas/fixtures) must be readable as it is, or
	// it would only ever be drawn as plain text.
	const fixtures = join(dirname(fileURLToPath(import.meta.url)), '../../../../canvas/fixtures')
	const schema = getSchema(tipTapDefaultExtensions)

	it.each(['default-shapes.json', 'lifeboard.json'])('read every label on %s', (file) => {
		const store = JSON.parse(readFileSync(join(fixtures, file), 'utf8')).store as Record<
			string,
			{ typeName: string; props?: { richText?: JSONContent } }
		>
		const labels = Object.values(store).flatMap((record) =>
			record.typeName === 'shape' && record.props?.richText ? [record.props.richText] : []
		)
		expect(labels.length).toBeGreaterThan(0)
		for (const label of labels) expect(() => Node.fromJSON(schema, label).check()).not.toThrow()
	})
})
