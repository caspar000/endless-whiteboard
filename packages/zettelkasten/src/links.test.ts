import { toRichText, type TLRichText } from '@lifeboard/canvas'
import { describe, expect, it } from 'vitest'
import { inlineLinks, linkGraph, outgoingLinks, type LinkedNote } from './links'

const note = (zid: string, text: string, more: Partial<LinkedNote> = {}): LinkedNote => ({
	zid,
	richText: toRichText(text) as TLRichText,
	links: [],
	keywords: [],
	cites: [],
	...more,
})

describe('links', () => {
	it('reads [[id]] links out of a note’s text, each once, ignoring what isn’t an id', () => {
		expect(inlineLinks(toRichText('See [[25a]] and [[ 3B ]], again [[25a]], not [[hello world]] or [[0]]'))).toEqual([
			'25a',
			'3b',
		])
		expect(inlineLinks(toRichText('As [[c2]] says'))).toEqual(['c2'])
	})

	it('joins the text’s links with the card’s own, and never links a note to itself', () => {
		expect(outgoingLinks(note('2', 'after [[1]] and [[2]]', { links: ['31', '1'] }))).toEqual(['1', '31'])
	})

	it('works out who links to whom, who cites what, and the index, in box order', () => {
		const graph = linkGraph([
			note('31', 'Later, back to [[2]]', { keywords: ['society'], cites: ['c1'] }),
			note('2', 'Itself [[1]]', { keywords: ['Society', '  power  structures '] }),
			note('1', 'First', { keywords: ['Ants'], cites: ['c1'] }),
		])
		expect(graph.linkedFrom.get('2')).toEqual(['31'])
		expect(graph.linkedFrom.get('1')).toEqual(['2'])
		expect(graph.citedBy.get('c1')).toEqual(['1', '31'])
		expect(graph.index).toEqual([
			{ keyword: 'Ants', zids: ['1'] },
			{ keyword: 'power structures', zids: ['2'] },
			// One keyword whatever its case, spelled as the first note in the box spells it.
			{ keyword: 'Society', zids: ['2', '31'] },
		])
	})
})
