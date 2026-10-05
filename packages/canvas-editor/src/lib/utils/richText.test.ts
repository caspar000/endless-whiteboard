import { richTextToPlainText } from './richText'

describe('richTextToPlainText', () => {
	it('joins text runs and puts each block on its own line', () => {
		const doc = {
			type: 'doc',
			content: [
				{ type: 'paragraph', content: [{ type: 'text', text: 'Rich ' }, { type: 'text', text: 'label', marks: [{ type: 'bold' }] }] },
				{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }] }] },
			],
		}
		expect(richTextToPlainText(doc as never)).toBe('Rich label\nfirst')
	})

	it('is empty for nothing', () => {
		expect(richTextToPlainText(undefined)).toBe('')
		expect(richTextToPlainText({ type: 'doc', content: [{ type: 'paragraph' }] } as never)).toBe('')
	})
})
