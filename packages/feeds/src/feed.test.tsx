import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { setBoardOf, setNetworkBridge, type ExternalText } from '@lifeboard/node-kit'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedProps } from './board'
import { FeedCard } from './feed/FeedCard'
import './index'
import { reading, REFRESH_MS } from './refresh'
import { SourcesPanel } from './SourcesPanel'
import { getCategories, getSourceItems, getSources, replaceCategories, replaceSourceItems, replaceSources, replaceWatched, watchedOn } from './store'

/*
 * The extension as a person uses it: the sources panel and a feed card mounted together, sites
 * answered from a table, and every step taken through the controls.
 */

const BEN = 'UCS0N5baNlQWJCUrhCEo8WlA'
const EEV = 'UC2DjFE7Xf11URZqWBigcVOQ'
const TONE = 'UCTUtqcDkzw7bisadh6AOx5w'
const feedUrl = (id: string) => `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`

/** A channel's feed as YouTube writes it: Atom, a `yt:videoId` per entry. */
function atom(title: string, videos: [id: string, title: string, published: string][]): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
 <title>${title}</title>
 ${videos
		.map(
			([id, name, published]) => `<entry>
  <id>yt:video:${id}</id><yt:videoId>${id}</yt:videoId><title>${name}</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=${id}"/><published>${published}</published>
 </entry>`
		)
		.join('\n')}
</feed>`
}

let pages: Record<string, string> = {}
const asked: string[] = []

function serve(): void {
	pages = {
		'https://www.youtube.com/@BenEater': `<link rel="canonical" href="https://www.youtube.com/channel/${BEN}">`,
		'https://www.youtube.com/@EEVblog': `<link rel="canonical" href="https://www.youtube.com/channel/${EEV}">`,
		'https://www.youtube.com/@12tone': `<link rel="canonical" href="https://www.youtube.com/channel/${TONE}">`,
		[feedUrl(BEN)]: atom('Ben Eater', [
			['benclock5aa', 'Breadboard clock part 5', '2026-11-18T14:00:00Z'],
			['benclock4aa', 'Breadboard clock part 4', '2026-11-03T15:00:00Z'],
		]),
		[feedUrl(EEV)]: atom('EEVblog', [['eevscope1aa', 'Oscilloscope teardown', '2026-11-17T09:00:00Z']]),
		[feedUrl(TONE)]: atom('12tone', [['tonechord1a', 'Why this chord is sad', '2026-11-19T08:00:00Z']]),
	}
}

/** A feed card on a board: `updateShape` changes the card's props, as the editor would. */
function Card() {
	const [props, setProps] = useState<FeedProps>({ name: 'My feeds', categoryId: '', show: 'unwatched' })
	const editor = {
		run: (fn: () => void) => fn(),
		updateShape: ({ props: next }: { props: Partial<FeedProps> }) => setProps((p) => ({ ...p, ...next })),
		select: () => {},
		setEditingShape: () => {},
	}
	// On board b1, as the app says as it opens (DARK-14).
	setBoardOf(editor as never, 'b1')
	const shape = { id: 'shape:feed', type: 'node.feed', props: { ...props, w: 420, h: 600 } }
	return <FeedCard shape={shape as never} isEditing={false} editor={editor as never} />
}

function mount() {
	render(
		<>
			<div data-testid="panel">
				<SourcesPanel boardId="b1" />
			</div>
			<div data-testid="card">
				<Card />
			</div>
		</>
	)
	return { panel: within(screen.getByTestId('panel')), card: within(screen.getByTestId('card')) }
}

/** The titles the card lists, top to bottom. */
const rows = () => [...screen.getByTestId('card').querySelectorAll('.lb-feed__title')].map((t) => t.textContent)
const chip = (card: ReturnType<typeof mount>['card'], name: RegExp) => card.getByRole('button', { name })

function newCategory(panel: ReturnType<typeof mount>['panel'], name: string) {
	// The form stays open after a category is made, for the next one.
	if (!panel.queryByLabelText('New category name')) fireEvent.click(panel.getByRole('button', { name: 'New category' }))
	fireEvent.change(panel.getByLabelText('New category name'), { target: { value: name } })
	fireEvent.click(panel.getByRole('button', { name: 'Create' }))
}

async function addChannel(panel: ReturnType<typeof mount>['panel'], input: string, category: string) {
	const select = panel.getByRole('combobox')
	const option = [...(select as HTMLSelectElement).options].find((o) => o.text === category)
	fireEvent.change(select, { target: { value: option?.value ?? '' } })
	fireEvent.change(panel.getByLabelText('Channel URL or @handle'), { target: { value: input } })
	fireEvent.click(panel.getByRole('button', { name: 'Add' }))
	await panel.findByText(new RegExp(`added${category ? ` to ${category}` : ''}\\.$`))
}

beforeEach(() => {
	replaceSources({})
	replaceCategories({})
	replaceWatched({})
	replaceSourceItems({})
	reading.set({ sourceIds: new Set(), unavailable: '' })
	serve()
	asked.length = 0
	setNetworkBridge({
		getJson: async () => null,
		getBlob: async () => null,
		getText: async (url): Promise<ExternalText> => {
			asked.push(url)
			return url in pages ? { ok: true, url, text: pages[url]! } : { ok: false, reason: 'failed', message: 'The site answered 404.' }
		},
	})
})

afterEach(() => {
	cleanup()
	vi.useRealTimers()
})

describe('the feeds extension', () => {
	it('adds channels through the panel, filed under categories, and lists every video newest first', async () => {
		const { panel } = mount()
		newCategory(panel, 'Electrical Engineering')
		newCategory(panel, 'Music')
		await addChannel(panel, '@BenEater', 'Electrical Engineering')
		await addChannel(panel, 'https://www.youtube.com/@EEVblog', 'Electrical Engineering')
		await addChannel(panel, 'youtube.com/@12tone', 'Music')

		await waitFor(() => expect(rows()).toHaveLength(4))
		expect(rows()).toEqual(['Why this chord is sad', 'Breadboard clock part 5', 'Oscilloscope teardown', 'Breadboard clock part 4'])
		expect(Object.values(getSources()).map((s) => [s.title, s.categories.map((c) => getCategories()[c]!.name)])).toEqual([
			['Ben Eater', ['Electrical Engineering']],
			['EEVblog', ['Electrical Engineering']],
			['12tone', ['Music']],
		])
	})

	it('filters the feed to one category with its chip, and back to everything with All', async () => {
		const { panel, card } = mount()
		newCategory(panel, 'Electrical Engineering')
		newCategory(panel, 'Music')
		await addChannel(panel, '@BenEater', 'Electrical Engineering')
		await addChannel(panel, '@12tone', 'Music')
		await waitFor(() => expect(rows()).toHaveLength(3))

		expect(chip(card, /^Electrical Engineering/).textContent).toBe('Electrical Engineering2')
		fireEvent.click(chip(card, /^Electrical Engineering/))
		expect(rows()).toEqual(['Breadboard clock part 5', 'Breadboard clock part 4'])
		fireEvent.click(chip(card, /^Music/))
		expect(rows()).toEqual(['Why this chord is sad'])
		fireEvent.click(chip(card, /^All/))
		expect(rows()).toHaveLength(3)
	})

	it('maintains categories: files a channel under a second one, renames, and deletes without losing the channel', async () => {
		const { panel, card } = mount()
		newCategory(panel, 'Electronics')
		newCategory(panel, 'Favourites')
		await addChannel(panel, '@BenEater', 'Electronics')
		await waitFor(() => expect(rows()).toHaveLength(2))

		// File it under Favourites too, from the chips under its name.
		fireEvent.click(within(panel.getByRole('group', { name: 'Categories of Ben Eater' })).getByRole('button', { name: /Favourites/ }))
		fireEvent.click(chip(card, /^Favourites/))
		expect(rows()).toHaveLength(2)

		// Rename: click the name, type, Enter. The card's chip follows.
		fireEvent.click(within(panel.getByRole('region', { name: 'Categories' })).getByRole('button', { name: 'Electronics' }))
		const field = panel.getByLabelText('Category name')
		fireEvent.change(field, { target: { value: 'Electrical Engineering' } })
		fireEvent.keyDown(field, { key: 'Enter' })
		expect(chip(card, /^Electrical Engineering/)).toBeTruthy()

		// Delete the one the card shows: the card goes back to All, and the channel stays.
		fireEvent.click(panel.getByRole('button', { name: 'Delete Favourites' }))
		fireEvent.click(panel.getByRole('button', { name: 'Delete' }))
		expect(card.queryByRole('button', { name: /^Favourites/ })).toBeNull()
		expect(chip(card, /^All/).getAttribute('aria-pressed')).toBe('true')
		expect(rows()).toHaveLength(2)
		expect(Object.values(getSources())[0]!.categories.map((c) => getCategories()[c]!.name)).toEqual(['Electrical Engineering'])
	})

	it('marks a video watched when it is opened, or by its dot, and back', async () => {
		const { panel, card } = mount()
		await addChannel(panel, '@BenEater', '')
		await waitFor(() => expect(rows()).toHaveLength(2))

		fireEvent.click(card.getByRole('link', { name: /Breadboard clock part 5/ }))
		expect(Object.keys(watchedOn('b1'))).toEqual(['yt:benclock5aa'])
		// Still listed under the pointer that opened it, without its dot.
		expect(rows()).toHaveLength(2)
		expect(card.getByRole('button', { name: 'Mark "Breadboard clock part 5" unwatched' })).toBeTruthy()

		fireEvent.click(card.getByRole('button', { name: 'Mark "Breadboard clock part 4" watched' }))
		fireEvent.click(card.getByRole('button', { name: 'Mark "Breadboard clock part 5" unwatched' }))
		expect(Object.keys(watchedOn('b1'))).toEqual(['yt:benclock4aa'])
		expect(chip(card, /^All/).textContent).toBe('All1')
	})

	it('reads its sources again once they are due, and shows what came in', async () => {
		vi.useFakeTimers({ toFake: ['setInterval'] })
		const { panel } = mount()
		await addChannel(panel, '@BenEater', '')
		await waitFor(() => expect(rows()).toHaveLength(2))
		const reads = () => asked.filter((u) => u === feedUrl(BEN)).length
		const before = reads()

		pages[feedUrl(BEN)] = atom('Ben Eater', [
			['benclock6aa', 'Breadboard clock part 6', '2026-11-20T14:00:00Z'],
			['benclock5aa', 'Breadboard clock part 5', '2026-11-18T14:00:00Z'],
		])
		// Read a minute ago: the card's check every minute leaves it be.
		await act(() => vi.advanceTimersByTimeAsync(60_000))
		expect(reads()).toBe(before)

		// Read a quarter of an hour ago: the next check reads it again.
		const [sourceId] = Object.keys(getSources())
		const kept = getSourceItems()[sourceId!]!
		replaceSourceItems({ [sourceId!]: { ...kept, fetchedAt: new Date(Date.now() - REFRESH_MS - 1000).toISOString() } })
		await act(() => vi.advanceTimersByTimeAsync(60_000))
		await waitFor(() => expect(rows()[0]).toBe('Breadboard clock part 6'))
		expect(reads()).toBe(before + 1)
		// The video the feed no longer lists is kept.
		expect(rows()).toEqual(['Breadboard clock part 6', 'Breadboard clock part 5', 'Breadboard clock part 4'])
	})

	it('shows every category, however many there are', async () => {
		const { panel, card } = mount()
		const names = ['Electrical Engineering', 'Analogue Synthesizers', 'Retro Computing', 'Woodworking', 'Music Theory', 'Physics Explained', 'Machining']
		for (const name of names) newCategory(panel, name)
		const toolbar = card.getByRole('toolbar', { name: 'Categories' })
		expect(within(toolbar).getAllByRole('button').map((b) => b.getAttribute('title') ?? b.textContent)).toEqual(['All', ...names, 'New category'])
	})

	it('says why a channel could not be added', async () => {
		const { panel } = mount()
		fireEvent.change(panel.getByLabelText('Channel URL or @handle'), { target: { value: '@nobody' } })
		fireEvent.click(panel.getByRole('button', { name: 'Add' }))
		expect(await panel.findByText(/Couldn't open that channel/)).toBeTruthy()
		expect(getSources()).toEqual({})
	})
})
