import { describe, expect, it } from 'vitest'
import { buildGraph, DEFAULT_LAYERS, orderParent, type GraphNote } from './graph'

const note = (zid: string, more: Partial<GraphNote> = {}): GraphNote => ({ zid, name: '', links: [], keywords: [], cites: [], ...more })

describe('the graph', () => {
	it('hangs each note from the one it was written behind, passing over deleted numbers', () => {
		const box = new Set(['1', '1a', '1a1', '1c', '2', '4'])
		const has = (zid: string) => box.has(zid)
		expect(orderParent('1', has)).toBe(null)
		expect(orderParent('1a', has)).toBe('1')
		expect(orderParent('1a1', has)).toBe('1a')
		// 1b was deleted: 1c hangs from 1a, the next one back.
		expect(orderParent('1c', has)).toBe('1a')
		// A train hangs from the one before it; 3 is gone, so 4 hangs from 2.
		expect(orderParent('2', has)).toBe('1')
		expect(orderParent('4', has)).toBe('2')
		expect(orderParent('1aa', (zid) => zid === '1z')).toBe('1z')
	})

	it('draws order and links by default, and keywords and sources only when asked', () => {
		const notes = [
			note('1', { name: 'Society', keywords: ['Society'] }),
			note('1a', { links: ['2', 'c1', '9'], cites: ['c1'], keywords: ['society'] }),
			note('2'),
		]
		const sources = [{ zid: 'c1', label: 'Luhmann 1984' }]
		const plain = buildGraph(notes, sources, DEFAULT_LAYERS)
		expect(plain.nodes.map((n) => n.id)).toEqual(['n:1', 'n:1a', 'n:2'])
		expect(plain.nodes[0]).toMatchObject({ label: '1 Society', head: true })
		expect(plain.edges).toEqual([
			{ source: 'n:1a', target: 'n:1', kind: 'order' },
			{ source: 'n:1a', target: 'n:2', kind: 'link' },
			{ source: 'n:2', target: 'n:1', kind: 'order' },
		])

		const all = buildGraph(notes, sources, { order: false, links: true, keywords: true, sources: true })
		expect(all.nodes.map((n) => n.id)).toEqual(['n:1', 'n:1a', 'n:2', 'k:society', 's:c1'])
		expect(all.edges).toEqual([
			{ source: 'n:1a', target: 'n:2', kind: 'link' },
			{ source: 'n:1a', target: 's:c1', kind: 'link' },
			{ source: 'n:1a', target: 's:c1', kind: 'cite' },
			{ source: 'n:1', target: 'k:society', kind: 'keyword' },
			{ source: 'n:1a', target: 'k:society', kind: 'keyword' },
		])
	})
})
