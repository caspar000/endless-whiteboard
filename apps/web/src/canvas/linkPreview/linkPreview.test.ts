import { describe, expect, it } from 'vitest'
import type { TLBookmarkAsset, TLBookmarkShape } from '@lifeboard/canvas'
import {
	LINK_PREVIEW_META,
	cropPosition,
	cropWindow,
	editsMeta,
	linkDomain,
	linkPreviewContent,
	parseTypedUrl,
	readEdits,
	readableAddress,
} from './linkPreview'

const card = (meta: Record<string, unknown> = {}, url = 'https://www.audeze.com/products/lcd-2/') =>
	({ id: 'shape:card', type: 'bookmark', props: { url, w: 280, h: 280, assetId: 'asset:page' }, meta }) as unknown as TLBookmarkShape

const page = {
	id: 'asset:page',
	type: 'bookmark',
	props: { src: 'https://www.audeze.com/products/lcd-2/', title: 'LCD-2', description: '', image: 'asset:aaa', favicon: 'asset:fav' },
} as unknown as TLBookmarkAsset

describe('linkPreviewContent', () => {
	it('shows what the page said, by its domain', () => {
		expect(linkPreviewContent(card(), page)).toMatchObject({
			title: 'LCD-2',
			domain: 'audeze.com',
			address: 'audeze.com/products/lcd-2',
			image: 'asset:aaa',
			favicon: 'asset:fav',
			focus: [0.5, 0.5],
		})
	})

	it('puts the card’s own name, picture and crop over the page’s', () => {
		const edited = card(editsMeta({ title: 'My headphones', image: 'asset:bbb', focus: [0.2, 0.9] }))
		expect(linkPreviewContent(edited, page)).toMatchObject({
			title: 'My headphones',
			image: 'asset:bbb',
			pageImage: 'asset:aaa',
			focus: [0.2, 0.9],
		})
	})

	it('goes by the domain until the page’s details arrive', () => {
		expect(linkPreviewContent(card(), null)).toMatchObject({ title: 'audeze.com', image: '' })
	})

	it('falls back to the page’s name when the card’s is blank', () => {
		expect(linkPreviewContent(card(editsMeta({ title: '   ' })), page).title).toBe('LCD-2')
	})
})

describe('readEdits', () => {
	it('reads back what editsMeta wrote, leaving unset things out', () => {
		const meta = editsMeta({ title: 'A', focus: [0.1, 0.2] })
		expect(meta[LINK_PREVIEW_META]).toEqual({ title: 'A', focus: [0.1, 0.2] })
		expect(readEdits(card(meta))).toEqual({ title: 'A', focus: [0.1, 0.2] })
		expect(editsMeta({})).toEqual({ [LINK_PREVIEW_META]: {} })
	})

	it('ignores what it can’t read, and keeps the focus on the picture', () => {
		expect(readEdits(card({ [LINK_PREVIEW_META]: 'nonsense' }))).toEqual({})
		expect(readEdits(card({ [LINK_PREVIEW_META]: { title: 3, image: '', focus: [2, -1] } }))).toEqual({ focus: [1, 0] })
		expect(readEdits(card({ [LINK_PREVIEW_META]: { focus: [0.5] } }))).toEqual({})
	})
})

describe('addresses', () => {
	it('names the site and shows the address without its noise', () => {
		expect(linkDomain('https://www.audeze.com/x')).toBe('audeze.com')
		expect(linkDomain('not a url')).toBe('')
		expect(readableAddress('https://www.audeze.com/products/lcd-2/?ref=a')).toBe('audeze.com/products/lcd-2?ref=a')
	})

	it('makes a typed address whole, and refuses what is not one', () => {
		expect(parseTypedUrl('audeze.com/products/lcd-2')).toBe('https://audeze.com/products/lcd-2')
		expect(parseTypedUrl(' http://example.com ')).toBe('http://example.com/')
		expect(parseTypedUrl('headphones')).toBeNull()
		expect(parseTypedUrl('javascript:alert(1)')).toBeNull()
		expect(parseTypedUrl('ftp://example.com/')).toBeNull()
		expect(parseTypedUrl('')).toBeNull()
	})
})

describe('the square crop', () => {
	it('centres the square on the focus, as far as the picture goes', () => {
		// 4:3, so a quarter of the width is outside the square.
		expect(cropPosition([0.5, 0.5], 800, 600)).toBe('50% 50%')
		expect(cropPosition([0, 0.5], 800, 600)).toBe('0% 50%')
		expect(cropPosition([1, 0.5], 800, 600)).toBe('100% 50%')
		// The visible three quarters centred on 0.6: from 0.225, of the 0.25 it can slide.
		expect(cropPosition([0.6, 0.5], 800, 600)).toBe('90% 50%')
		// A tall picture slides up and down; a square one doesn't move.
		expect(cropPosition([0.1, 0.25], 600, 800)).toBe('50% 0%')
		expect(cropPosition([0.1, 0.9], 500, 500)).toBe('50% 50%')
		expect(cropPosition([0.1, 0.9], 0, 0)).toBe('50% 50%')
	})

	it('outlines the same part of the picture in the inspector', () => {
		const wide = cropWindow([0.6, 0.5], 800, 600)
		expect(wide.left).toBeCloseTo(0.225)
		expect(wide).toMatchObject({ top: 0, width: 0.75, height: 1 })
		expect(cropWindow([0.5, 1], 600, 800)).toEqual({ left: 0, top: 0.25, width: 1, height: 0.75 })
	})
})
