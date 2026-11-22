import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { registerItemSource, setAssetBridge, setBoardOf, setNetworkBridge, type ExternalText } from '@lifeboard/node-kit'
import { RANDOMIZER_TYPE, randomizerNodeDefinition, replaceStamped, type RandomizerProps } from '@lifeboard/randomizer'
import { useMemo, useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// The barrel, as the app loads it: this is what registers Feeds with the randomizer.
import './index'
import { refreshSources } from './refresh'
import { addSource, replaceCategories, replaceSourceItems, replaceSources, replaceWatched, watchedOn } from './store'

/*
 * DARK-7's connection, as a person makes it: a YouTube channel read through the app's network bridge
 * into Feeds, and a randomizer card on the board that is pointed at it, shuffles its videos and opens
 * one. Nothing is stubbed between the two extensions: the card finds Feeds through the registration
 * the feeds barrel makes.
 */

const BEN = 'UCS0N5baNlQWJCUrhCEo8WlA'
const FEED = `https://www.youtube.com/feeds/videos.xml?channel_id=${BEN}`

/** The channel's feed as YouTube writes it. */
const CHANNEL = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
 <title>Ben Eater</title>
 <entry><id>yt:video:benclock5aa</id><yt:videoId>benclock5aa</yt:videoId><title>Breadboard clock part 5</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=benclock5aa"/><published>2026-11-18T14:00:00Z</published></entry>
 <entry><id>yt:video:benclock4aa</id><yt:videoId>benclock4aa</yt:videoId><title>Breadboard clock part 4</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=benclock4aa"/><published>2026-11-03T15:00:00Z</published></entry>
</feed>`

let sourceKey = ''
/** The board's own props, to change as an undo or another device would. */
let setBoardProps: (change: (p: RandomizerProps) => RandomizerProps) => void = () => {}

/** A randomizer on a board: the editor writes the card's props and opens its editor, as the real one does. */
function Board({ onProps }: { onProps: (props: RandomizerProps) => void }) {
	const [props, setProps] = useState<RandomizerProps>(() => randomizerNodeDefinition.defaultProps())
	const [editing, setEditing] = useState(false)
	setBoardProps = setProps
	const shape = { id: 'shape:rand', type: RANDOMIZER_TYPE, x: 0, y: 0, rotation: 0, props: { ...props, w: 360, h: 520 }, meta: {} }
	const latest = useRef(shape)
	latest.current = shape
	onProps(props)
	const editor = useMemo(
		() => ({
			run: (fn: () => void) => fn(),
			updateShape: ({ props: next }: { props: Partial<RandomizerProps> }) => setProps((p) => ({ ...p, ...next })),
			getShape: () => latest.current,
			select: () => {},
			setEditingShape: (id: string | null) => setEditing(id !== null),
			addOpenMenu: () => {},
			deleteOpenMenu: () => {},
			getShapePageBounds: () => ({ x: 0, y: 0, w: 360, h: 520 }),
			getViewportScreenBounds: () => ({ x: 0, y: 0, w: 1440, h: 900 }),
			pageToScreen: (p: { x: number; y: number }) => p,
			getContainer: () => document.body,
		}),
		[]
	)
	// On board b1, as the app says as it opens (DARK-14).
	setBoardOf(editor as never, 'b1')
	const Card = randomizerNodeDefinition.component
	return <Card shape={shape as never} isEditing={editing} editor={editor as never} />
}

let props: RandomizerProps
const mount = () => render(<Board onProps={(p) => (props = p)} />)
const card = () => screen.getByLabelText('Randomizer')

beforeEach(async () => {
	replaceSources({})
	replaceCategories({})
	replaceSourceItems({})
	replaceWatched({})
	setNetworkBridge({
		getJson: async () => null,
		getBlob: async () => null,
		getText: async (url): Promise<ExternalText> => (url === FEED ? { ok: true, url, text: CHANNEL } : { ok: false, reason: 'failed', message: `No page at ${url}` }),
	})
	addSource('b1', { provider: 'youtube', feedUrl: FEED, link: `https://www.youtube.com/channel/${BEN}`, title: 'Ben Eater', categories: [] })
	// Every feed: one channel alone is not offered (DARK-14), and Ben Eater is the only one here.
	sourceKey = 'feeds:all:b1'
	await refreshSources({ force: true })
	// Reduced motion: the pick fades in rather than flipping through two dozen timed flaps.
	vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
})

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe('a randomizer connected to a YouTube channel', () => {
	it('starts as an empty front waiting for a source, with no Albums, Films or Books', () => {
		mount()
		expect(within(card()).getByText('Waiting for a source')).toBeTruthy()
		expect(within(card()).getByRole('button', { name: 'Choose what to shuffle' })).toBeTruthy()
		expect(within(card()).queryByRole('radiogroup')).toBeNull()
		for (const tab of ['Albums', 'Films', 'Books']) expect(within(card()).queryByText(tab)).toBeNull()
		expect(props.source).toBe('')
	})

	it("offers all feeds but never the channel alone, and shuffles the feeds' videos once picked", async () => {
		mount()
		fireEvent.click(within(card()).getByRole('button', { name: 'Choose what to shuffle' }))

		const picker = screen.getByLabelText('Shuffle from') as HTMLSelectElement
		const offered = Array.from(picker.options).map((o) => o.textContent)
		expect(offered).toEqual(expect.arrayContaining(['A list I type', 'All feeds']))
		expect(offered).not.toContain('Ben Eater')
		fireEvent.change(picker, { target: { value: sourceKey } })
		expect(props.source).toBe(sourceKey)
		expect(screen.getByText(/2 videos from All feeds/)).toBeTruthy()
		fireEvent.click(screen.getByRole('button', { name: 'Done' }))

		// The card now shows the feeds: their name on top, its videos counted, the newest on show.
		expect(within(card()).getByRole('button', { name: 'Shuffling All feeds. Change the source' })).toBeTruthy()
		expect(within(card()).getByText('2 videos')).toBeTruthy()
		expect(within(card()).getByRole('img', { name: 'Video cover: Breadboard clock part 5 by Ben Eater' })).toBeTruthy()

		fireEvent.click(within(card()).getByRole('button', { name: /^Shuffle/ }))
		await waitFor(() => expect(props.picks).toEqual([{ source: sourceKey, id: 'yt:benclock4aa' }]))
		expect(within(card()).getByText('Picked Breadboard clock part 4 by Ben Eater, 3 Nov 2026.')).toBeTruthy()
	})

	it('opens the video on show on YouTube and marks it watched in Feeds', async () => {
		mount()
		fireEvent.click(within(card()).getByRole('button', { name: 'Choose what to shuffle' }))
		fireEvent.change(screen.getByLabelText('Shuffle from'), { target: { value: sourceKey } })
		fireEvent.click(screen.getByRole('button', { name: 'Done' }))

		const open = vi.spyOn(window, 'open').mockImplementation(() => null)
		await act(async () => fireEvent.click(within(card()).getByRole('button', { name: 'Open Breadboard clock part 5' })))
		expect(open).toHaveBeenCalledWith('https://www.youtube.com/watch?v=benclock5aa', '_blank', 'noopener,noreferrer')
		expect(watchedOn('b1')['yt:benclock5aa']).toBeTruthy()
	})

	it('shows a placeholder, never the last picture, while a video’s thumbnail loads (DARK-13)', () => {
		mount()
		fireEvent.click(within(card()).getByRole('button', { name: 'Choose what to shuffle' }))
		fireEvent.change(screen.getByLabelText('Shuffle from'), { target: { value: sourceKey } })
		fireEvent.click(screen.getByRole('button', { name: 'Done' }))

		const stage = within(card()).getByRole('img', { name: /^Video cover/ })
		const top = stage.querySelector('.lb-rand__half--top')!
		expect(top.querySelector('.lb-rand__ph')?.textContent).toBe('Breadboard clock part 5')
		const picture = top.querySelector('img')!
		expect(picture.classList.contains('lb-rand__img--loading')).toBe(true)
		fireEvent.load(picture)
		expect(top.querySelector('.lb-rand__ph')).toBeNull()
		expect(top.querySelector('img')!.classList.contains('lb-rand__img--loading')).toBe(false)
	})

	it('takes the window shape it is set to, as it is changed and when it is undone (DARK-13)', () => {
		mount()
		fireEvent.click(within(card()).getByRole('button', { name: 'Choose what to shuffle' }))
		fireEvent.change(screen.getByLabelText('Shuffle from'), { target: { value: sourceKey } })
		const stage = () => within(card()).getByRole('img', { name: /^Video cover/ }) as HTMLElement
		// Only the shape changes, with the editor still open: the window follows at once.
		fireEvent.change(screen.getByLabelText("The window's shape"), { target: { value: '16:9' } })
		expect(props.aspect).toBe('16:9')
		expect(stage().style.aspectRatio).toMatch(/^1\.777/)
		expect((screen.getByLabelText("The window's shape") as HTMLSelectElement).value).toBe('16:9')
		fireEvent.click(screen.getByRole('button', { name: 'Done' }))
		// Undone with the editor closed: square again.
		act(() => setBoardProps((p) => ({ ...p, aspect: '' })))
		expect(stage().style.aspectRatio).toBe('')
	})

	it('shows a placeholder, not the cover before, while a dropped cover is still being fetched (DARK-13)', async () => {
		// Every face of the card asks for its picture; each waits until the test lets that src through.
		const waiting = new Map<string, Array<(url: string) => void>>()
		const resolve = (src: string, url: string) => {
			for (const done of waiting.get(src) ?? []) done(url)
			waiting.delete(src)
		}
		setAssetBridge({
			store: async () => '',
			getBlob: async () => null,
			resolveUrl: (src) => new Promise((done) => waiting.set(src, [...(waiting.get(src) ?? []), done])),
		})
		const typed = (id: string) => ({ id, source: 'list', title: `Record ${id}`, creator: '', year: '', cover: `asset:${id}`, stamps: [] })
		mount()
		act(() => setBoardProps((p) => ({ ...p, source: 'list', items: [typed('a'), typed('b')], picks: [{ source: 'list', id: 'a' }] })))
		const top = () => card().querySelector('.lb-rand__half--top')!
		expect(top().querySelector('.lb-rand__ph')?.textContent).toBe('Record a')
		await act(async () => resolve('asset:a', 'blob:a'))
		fireEvent.load(top().querySelector('img')!)
		expect(top().querySelector('img')!.getAttribute('src')).toBe('blob:a')
		expect(top().querySelector('.lb-rand__ph')).toBeNull()

		// The pick moves to b while b's picture is still on its way: b's placeholder, never a's picture.
		act(() => setBoardProps((p) => ({ ...p, picks: [{ source: 'list', id: 'b' }, ...p.picks] })))
		expect(top().querySelector('.lb-rand__ph')?.textContent).toBe('Record b')
		expect(top().querySelector('img')!.getAttribute('src')).not.toBe('blob:a')
		await act(async () => resolve('asset:b', 'blob:b'))
		fireEvent.load(top().querySelector('img')!)
		expect(top().querySelector('img')!.getAttribute('src')).toBe('blob:b')
		expect(top().querySelector('.lb-rand__ph')).toBeNull()
	})

	it('takes an album ranked on a Ranking Tiers card out of its shuffle, with the ranking’s stamp (DARK-13)', () => {
		const typed = (id: string) => ({ id, source: 'list', title: `Record ${id}`, creator: 'Band', year: '', cover: '', stamps: [] })
		mount()
		act(() => setBoardProps((p) => ({ ...p, source: 'list', items: [typed('a'), typed('b')], picks: [{ source: 'list', id: 'a' }] })))
		expect(within(card()).getByRole('button', { name: /^Shuffle/ }).getAttribute('aria-disabled')).toBe('false')
		// Ranked elsewhere: the vault's stamped list has the ranking's Liked stamp on Record a, by title and artist.
		act(() =>
			replaceStamped({
				'ranking/r1#feeds:all|x': { key: 'ranking/r1#feeds:all|x', card: 'ranking/r1', item: 'feeds:all|x', source: 'feeds:all', id: 'x', title: 'record A', creator: 'band', year: '', cover: '', url: '', kind: 'liked', date: '2026-11-21' },
			})
		)
		expect(within(card()).getByText(/Ranked, so/)).toBeTruthy()
		expect(within(card()).queryByRole('button', { name: 'Undo' })).toBeNull()
		// Only Record b is left to shuffle to, and the card stored none of it.
		expect(props.items.every((i) => i.stamps.every((s) => !('ranked' in s)))).toBe(true)
		act(() => replaceStamped({}))
	})

	it('still draws from a weighted ranking whose albums were stamped Liked by being ranked (DARK-13)', async () => {
		// A weighted ranking of two albums, offered as Ranking Tiers offers it: ranked items, by weight.
		const ranked = [
			{ id: 'r1', title: 'Kind of Blue', creator: 'Miles Davis', year: '', cover: '', url: '', weight: 4 },
			{ id: 'r2', title: 'In a Silent Way', creator: 'Miles Davis', year: '', cover: '', url: '', weight: 1 },
		]
		registerItemSource({
			id: 'ranking',
			label: 'Rankings',
			ranked: true,
			choices: () => [{ id: 'jazz', label: 'Jazz, ranked', group: '' }],
			entries: () => ranked,
			kind: () => ({ noun: 'albums', one: 'album', creator: 'Artist', tag: '', shape: 'square' }),
		})
		// Ranking them stamped both Liked, in the vault.
		const stamp = (e: (typeof ranked)[number]) => ({
			key: `ranking/jazz#syllabus:m|${e.id}`,
			card: 'ranking/jazz',
			item: `syllabus:m|${e.id}`,
			source: 'syllabus:m',
			id: e.id,
			title: e.title,
			creator: e.creator,
			year: '',
			cover: '',
			url: '',
			kind: 'liked' as const,
			date: '2026-11-21',
		})
		act(() => replaceStamped(Object.fromEntries(ranked.map((e) => [stamp(e).key, stamp(e)]))))
		mount()
		act(() => setBoardProps((p) => ({ ...p, source: 'ranking:jazz' })))
		const shuffle = within(card()).getByRole('button', { name: /^Shuffle/ })
		expect(shuffle.getAttribute('aria-disabled')).toBe('false')
		expect(within(card()).queryByText(/Ranked, so/)).toBeNull()
		fireEvent.click(shuffle)
		await waitFor(() => expect(props.picks[0]?.source).toBe('ranking:jazz'))
		act(() => replaceStamped({}))
	})
})
