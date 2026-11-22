import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { atom } from '@lifeboard/canvas'
import {
	ITEM_DRAG_TYPE,
	clearItemMarks,
	clearItemSources,
	offeredItemSources,
	registerItemReaction,
	registerItemSource,
	registerItemStamps,
	setBoardOf,
	setExtensionEnabled,
	type RankedItem,
	type SourceEntry,
} from '@lifeboard/node-kit'
import { useMemo, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { rankingNodeDefinition } from './definition'
import { setPrefs } from './prefs'
import type { RankingProps } from './props'
import { RANKING_EXTENSION_ID, rankingSource } from './source'
import { rankings } from './store'

/*
 * The card as a person uses it, rendered: a source chosen from the picker, covers moved between tiers
 * by keyboard and by drag, tiers added, renamed and removed, weighted shuffle turned on, and the
 * ranking then offered to randomizers. Its items come from a source registered here, in the kit's
 * registry, as Feeds or the Syllabus would register theirs: no other extension is loaded.
 */

const ALBUMS = 'shelf:albums'

let albums: SourceEntry[] = []
const album = (i: number): SourceEntry => ({ id: `a${i}`, title: `Album ${i}`, creator: `Band ${i}`, year: '', cover: '', url: '' })

/** A ranking card on a board: the editor opens its picker, as the real one does. */
function Board({ rankingId }: { rankingId: string }) {
	const [editing, setEditing] = useState(false)
	const shape = { id: 'shape:rank', type: 'node.ranking', x: 0, y: 0, rotation: 0, props: { rankingId, autoHeight: true, w: 620, h: 400 } as RankingProps, meta: {} }
	const editor = useMemo(
		() => ({
			select: () => {},
			setEditingShape: (id: string | null) => setEditing(id !== null),
			addOpenMenu: () => {},
			deleteOpenMenu: () => {},
			getShapePageBounds: () => ({ x: 0, y: 0, w: 620, h: 400 }),
			getViewportScreenBounds: () => ({ x: 0, y: 0, w: 1440, h: 900 }),
			pageToScreen: (p: { x: number; y: number }) => p,
			getContainer: () => document.body,
		}),
		[]
	)
	// The board it is on, as the app says it when the board opens (DARK-14).
	setBoardOf(editor as never, 'board-1')
	const Card = rankingNodeDefinition.component
	return <Card shape={shape as never} isEditing={editing} editor={editor as never} />
}

const card = () => screen.getByLabelText('Ranking tiers')
const band = (name: string) => within(card()).getByRole('region', { name: `${name} tier` })
const coversIn = (name: string) => within(band(name)).queryAllByRole('listitem').map((el) => el.getAttribute('data-item-id'))
const ranking = () => Object.values(rankings.get())[0]!

/** A drag's data, as the browser hands it from dragstart to drop. */
function dataTransfer() {
	const data = new Map<string, string>()
	return {
		setData: (type: string, value: string) => void data.set(type, value),
		getData: (type: string) => data.get(type) ?? '',
		get types() {
			return [...data.keys()]
		},
		effectAllowed: 'all',
		dropEffect: 'none',
	}
}

/** Opens the card, and ranks the shelf's albums with it. */
function rankAlbums() {
	render(<Board rankingId="r1" />)
	fireEvent.click(within(card()).getByRole('button', { name: 'Choose what to rank' }))
	fireEvent.change(screen.getByLabelText('Rank from'), { target: { value: ALBUMS } })
	fireEvent.click(screen.getByRole('button', { name: 'Done' }))
}

beforeEach(() => {
	albums = [1, 2, 3, 4, 5].map(album)
	registerItemSource(rankingSource)
	registerItemSource({
		id: 'shelf',
		label: 'Shelf',
		choices: () => [{ id: 'albums', label: 'My albums', group: '' }],
		entries: () => albums,
		kind: () => ({ noun: 'albums', one: 'album', creator: 'Artist', tag: '', shape: 'square' }),
	})
	rankings.replace({})
	setPrefs({ percent: false })
})

afterEach(() => {
	cleanup()
	clearItemSources()
	clearItemMarks()
	setExtensionEnabled(RANKING_EXTENSION_ID, true)
})

describe('a ranking card', () => {
	it('ranks any source in the registry, but never a ranking', () => {
		render(<Board rankingId="r1" />)
		expect(within(card()).getByText('Nothing to rank yet')).toBeTruthy()
		fireEvent.click(within(card()).getByRole('button', { name: 'Choose what to rank' }))
		const offered = Array.from((screen.getByLabelText('Rank from') as HTMLSelectElement).options).map((o) => o.value)
		expect(offered).toContain(ALBUMS)
		expect(offered.some((key) => key.startsWith('ranking:'))).toBe(false)
	})

	it('starts with everything unranked in the rail, and the four listening tiers', () => {
		rankAlbums()
		expect(within(card()).getByText('5 albums')).toBeTruthy()
		expect(within(card()).getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual([
			'Heavy rotation tier',
			'Often tier',
			'Now and then tier',
			'Rarely tier',
		])
		fireEvent.click(within(card()).getByRole('button', { name: /^Unranked, 5/ }))
		expect(within(screen.getByRole('list', { name: 'Unranked' })).getAllByRole('listitem')).toHaveLength(5)
	})

	it('moves a cover between tiers with the arrow keys', () => {
		rankAlbums()
		fireEvent.click(within(card()).getByRole('button', { name: /^Unranked/ }))
		const first = within(screen.getByRole('list', { name: 'Unranked' })).getAllByRole('listitem')[0]!
		fireEvent.keyDown(first, { key: 'ArrowUp' })
		expect(coversIn('Rarely')).toEqual(['a1'])
		fireEvent.keyDown(within(band('Rarely')).getAllByRole('listitem')[0]!, { key: 'ArrowUp' })
		expect(coversIn('Now and then')).toEqual(['a1'])
		expect(coversIn('Rarely')).toEqual([])
	})

	it('moves a cover between tiers by dragging it, and carries it as an item other cards take', () => {
		rankAlbums()
		fireEvent.click(within(card()).getByRole('button', { name: /^Unranked/ }))
		const drag = dataTransfer()
		fireEvent.dragStart(within(screen.getByRole('list', { name: 'Unranked' })).getAllByRole('listitem')[1]!, { dataTransfer: drag })
		expect(JSON.parse(drag.getData(ITEM_DRAG_TYPE))).toMatchObject({ entry: { id: 'a2', title: 'Album 2' }, from: ALBUMS, via: 'Shelf' })
		fireEvent.dragOver(band('Often'), { dataTransfer: drag })
		fireEvent.drop(band('Often'), { dataTransfer: drag })
		expect(coversIn('Often')).toEqual(['a2'])
	})

	it('never hides a cover: a full tier shows every one of them', () => {
		albums = Array.from({ length: 40 }, (_, i) => album(i))
		rankAlbums()
		act(() => rankings.put('r1', { ...ranking(), placed: { [ALBUMS]: { t1: albums.map((a) => a.id) } } }))
		expect(coversIn('Heavy rotation')).toHaveLength(40)
		expect(within(card()).queryByText(/more$/)).toBeNull()
	})

	it('adds, renames, moves and removes tiers, and a removed tier’s covers go back to the rail', () => {
		rankAlbums()
		fireEvent.click(within(card()).getByRole('button', { name: 'Add a tier' }))
		expect(band('New tier')).toBeTruthy()

		fireEvent.click(within(band('New tier')).getByRole('button', { name: 'New tier' }))
		const name = within(band('New tier')).getByRole('textbox', { name: 'Tier name' })
		fireEvent.change(name, { target: { value: 'Once a year' } })
		fireEvent.blur(name)
		expect(band('Once a year')).toBeTruthy()

		fireEvent.click(within(band('Once a year')).getByRole('button', { name: 'Once a year options' }))
		fireEvent.click(screen.getByRole('menuitem', { name: /Move up/ }))
		expect(within(card()).getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual([
			'Heavy rotation tier',
			'Often tier',
			'Now and then tier',
			'Once a year tier',
			'Rarely tier',
		])

		act(() => rankings.put('r1', { ...ranking(), placed: { [ALBUMS]: { t1: ['a1', 'a2'] } } }))
		fireEvent.click(within(band('Heavy rotation')).getByRole('button', { name: 'Heavy rotation options' }))
		fireEvent.click(screen.getByRole('menuitem', { name: /Remove tier/ }))
		expect(within(card()).queryByRole('region', { name: 'Heavy rotation tier' })).toBeNull()
		expect(within(card()).getByRole('button', { name: /^Unranked, 5/ })).toBeTruthy()
	})

	it('shows weights and odds only with weighted shuffle on, and only then is offered to randomizers', () => {
		rankAlbums()
		act(() => rankings.put('r1', { ...ranking(), placed: { [ALBUMS]: { t1: ['a1'], t2: ['a2', 'a3'], t4: ['a4'] } } }))
		expect(within(card()).queryByText('1 in 3')).toBeNull()
		expect(within(band('Often')).queryByRole('button', { name: /weight/ })).toBeNull()
		// Unweighted, a randomizer can still draw from one tier at a time (DARK-14), but not the whole.
		expect(rankingSource.choices('board-1').map((c) => c.id)).not.toContain('r1')
		expect(rankingSource.choices('board-1').map((c) => c.label)).toContain('My albums, ranked: Often')
		expect(rankingSource.entries('r1#t2').map((e) => e.id)).toEqual(['a2', 'a3'])

		fireEvent.click(within(card()).getByRole('button', { name: 'Ranking settings' }))
		fireEvent.click(screen.getByRole('checkbox', { name: /Weighted shuffle/ }))
		// 4×1, 3×2, 1×1 of 11: Heavy rotation 1 in 3, Often 1 in 2, Rarely 1 in 11.
		expect(within(band('Heavy rotation')).getByText('1 in 3')).toBeTruthy()
		expect(within(band('Often')).getByText('1 in 2')).toBeTruthy()
		expect(within(band('Rarely')).getByText('1 in 11')).toBeTruthy()
		expect(rankingSource.choices('board-1').map((c) => c.id)[0]).toBe('r1')
		// Never on another board.
		expect(rankingSource.choices('board-2')).toEqual([])
		// Its items are ranked: a randomizer drawing from it doesn't count that as taking them out (DARK-13).
		expect(rankingSource.ranked).toBe(true)
		expect(rankingSource.entries('r1').map((e) => [e.id, e.weight])).toEqual([
			['a1', 4],
			['a2', 3],
			['a3', 3],
			['a4', 1],
		])

		fireEvent.click(within(band('Heavy rotation')).getByRole('button', { name: /weight 4 of 5/ }))
		expect(rankingSource.entries('r1')[0]?.weight).toBe(3)
	})

	it('stops being offered while Ranking Tiers is off, and keeps working on the board', () => {
		rankAlbums()
		act(() => rankings.put('r1', { ...ranking(), weighted: true, placed: { [ALBUMS]: { t1: ['a1'] } } }))
		expect(offeredItemSources().map((s) => s.id)).toContain('ranking')
		act(() => setExtensionEnabled(RANKING_EXTENSION_ID, false))
		expect(offeredItemSources().map((s) => s.id)).not.toContain('ranking')
		expect(coversIn('Heavy rotation')).toEqual(['a1'])
	})

	it('searches the unranked rail by title or artist', () => {
		rankAlbums()
		fireEvent.click(within(card()).getByRole('button', { name: /^Unranked/ }))
		const search = within(card()).getByRole('searchbox', { name: 'Search unranked' })
		fireEvent.change(search, { target: { value: 'band 3' } })
		const rail = () => within(screen.getByRole('list', { name: 'Unranked' }))
		expect(rail().getAllByRole('listitem').map((el) => el.getAttribute('data-item-id'))).toEqual(['a3'])
		fireEvent.change(search, { target: { value: 'nothing like it' } })
		expect(rail().queryAllByRole('listitem')).toHaveLength(0)
		expect(rail().getByText('Nothing matches')).toBeTruthy()
		fireEvent.keyDown(search, { key: 'Escape' })
		expect(rail().getAllByRole('listitem')).toHaveLength(5)
	})

	it('tells the other extensions when a cover is ranked out of Unranked, and only then', () => {
		const heard: RankedItem[] = []
		registerItemReaction({ id: 'test.heard', ranked: (item) => void heard.push(item) })
		rankAlbums()
		fireEvent.click(within(card()).getByRole('button', { name: /^Unranked/ }))
		fireEvent.change(within(card()).getByRole('searchbox', { name: 'Search unranked' }), { target: { value: 'Album 4' } })
		const drag = dataTransfer()
		fireEvent.dragStart(within(screen.getByRole('list', { name: 'Unranked' })).getAllByRole('listitem')[0]!, { dataTransfer: drag })
		fireEvent.dragOver(band('Often'), { dataTransfer: drag })
		fireEvent.drop(band('Often'), { dataTransfer: drag })
		expect(heard).toEqual([{ entry: albums[3], from: ALBUMS, rankingId: 'r1', boardId: 'board-1', editor: expect.anything(), shapeId: 'shape:rank' }])

		// Between tiers, or back to the rail, it is already ranked.
		fireEvent.keyDown(within(band('Often')).getAllByRole('listitem')[0]!, { key: 'ArrowUp' })
		fireEvent.keyDown(within(band('Heavy rotation')).getAllByRole('listitem')[0]!, { key: 'ArrowDown' })
		expect(heard).toHaveLength(1)
	})

	it('shows stamp badges, keeps a cover in its tier whatever is switched off, and shapes its covers', () => {
		stampAlbums({ 'Album 1': 'liked', 'Album 2': 'disliked' })
		rankAlbums()
		act(() => rankings.put('r1', { ...ranking(), placed: { [ALBUMS]: { t1: ['a1', 'a2', 'a3'] } } }))
		expect(within(band('Heavy rotation')).getAllByRole('listitem')[0]!.getAttribute('aria-label')).not.toMatch(/Stamped/)

		fireEvent.click(within(card()).getByRole('button', { name: 'Ranking settings' }))
		fireEvent.click(screen.getByRole('checkbox', { name: /Stamp badges/ }))
		expect(within(band('Heavy rotation')).getAllByRole('listitem')[0]!.getAttribute('aria-label')).toMatch(/Stamped Liked/)

		// The switches choose what waits in the queue: a cover already in a tier stays put (DARK-14).
		fireEvent.click(screen.getByRole('switch', { name: 'Disliked' }))
		expect(coversIn('Heavy rotation')).toEqual(['a1', 'a2', 'a3'])

		fireEvent.change(screen.getByLabelText('Cover shape'), { target: { value: '16:9' } })
		expect(ranking().aspect).toBe('16:9')
		expect(card().style.getPropertyValue('--lb-rank-aspect')).toBe(String(16 / 9))
	})
})

/** Stamps the randomizer would have given, by title, and the kinds it gives. */
function stampAlbums(stamps: Record<string, string>, dates: Record<string, string> = {}) {
	const KINDS = [
		{ id: 'liked', label: 'Liked', ink: '#2f9e44' },
		{ id: 'disliked', label: 'Disliked', ink: '#e03131' },
		{ id: 'unsure', label: 'Unsure', ink: '#f08c00' },
	]
	const latest = atom<Record<string, string>>('test:stamps', stamps)
	const seen: string[] = []
	registerItemStamps({
		sourceId: 'stamped',
		kinds: KINDS,
		stampOf: (e, boardId) => {
			seen.push(boardId)
			const kind = latest.get()[e.title]
			return kind ? { kind, date: dates[e.title] ?? '2026-11-01' } : null
		},
	})
	return { latest, seen }
}

const queued = () => within(within(card()).getByRole('list', { name: 'Rank queue' })).queryAllByRole('listitem').map((el) => el.getAttribute('data-item-id'))
const railed = () => within(screen.getByRole('list', { name: 'Unranked' })).queryAllByRole('listitem').map((el) => el.getAttribute('data-item-id'))

describe('the rank queue (DARK-14)', () => {
	it('holds what was stamped, newest first, ready to drag into a tier, and the rail the rest', () => {
		const { seen } = stampAlbums({ 'Album 1': 'liked', 'Album 2': 'unsure', 'Album 3': 'disliked' }, { 'Album 1': '2026-11-01', 'Album 2': '2026-11-03', 'Album 3': '2026-11-02' })
		rankAlbums()
		expect(queued()).toEqual(['a2', 'a3', 'a1'])
		// The stamps are this board's.
		expect(new Set(seen)).toEqual(new Set(['board-1']))
		fireEvent.click(within(card()).getByRole('button', { name: /^Unranked, 2/ }))
		expect(railed()).toEqual(['a4', 'a5'])

		const drag = dataTransfer()
		fireEvent.dragStart(within(within(card()).getByRole('list', { name: 'Rank queue' })).getAllByRole('listitem')[0]!, { dataTransfer: drag })
		fireEvent.dragOver(band('Often'), { dataTransfer: drag })
		fireEvent.drop(band('Often'), { dataTransfer: drag })
		expect(coversIn('Often')).toEqual(['a2'])
		expect(queued()).toEqual(['a3', 'a1'])
	})

	it('shows only the kinds switched on, and all of them again once switched back', () => {
		stampAlbums({ 'Album 1': 'liked', 'Album 2': 'unsure', 'Album 3': 'disliked' })
		rankAlbums()
		fireEvent.click(within(card()).getByRole('button', { name: 'Ranking settings' }))
		fireEvent.click(screen.getByRole('switch', { name: 'Unsure' }))
		fireEvent.click(screen.getByRole('switch', { name: 'Disliked' }))
		expect(queued()).toEqual(['a1'])
		expect(ranking().stampFilter).toEqual({ unsure: false, disliked: false })
		fireEvent.click(screen.getByRole('switch', { name: 'Unsure' }))
		fireEvent.click(screen.getByRole('switch', { name: 'Disliked' }))
		expect(queued().sort()).toEqual(['a1', 'a2', 'a3'])
	})

	it('is not stamped again by moving between tiers, and only tells the others when it leaves the queue', () => {
		const heard: RankedItem[] = []
		registerItemReaction({ id: 'test.heard', ranked: (item) => void heard.push(item) })
		stampAlbums({ 'Album 1': 'liked' })
		rankAlbums()
		fireEvent.keyDown(within(within(card()).getByRole('list', { name: 'Rank queue' })).getAllByRole('listitem')[0]!, { key: 'ArrowDown' })
		expect(coversIn('Heavy rotation')).toEqual(['a1'])
		fireEvent.keyDown(within(band('Heavy rotation')).getAllByRole('listitem')[0]!, { key: 'ArrowDown' })
		fireEvent.keyDown(within(band('Often')).getAllByRole('listitem')[0]!, { key: 'ArrowDown' })
		expect(coversIn('Now and then')).toEqual(['a1'])
		expect(heard).toHaveLength(1)
		// Up past the first tier, it waits in the queue again.
		act(() => rankings.put('r1', { ...ranking(), placed: { [ALBUMS]: { t1: ['a1'] } } }))
		fireEvent.keyDown(within(band('Heavy rotation')).getAllByRole('listitem')[0]!, { key: 'ArrowUp' })
		expect(queued()).toEqual(['a1'])
	})
})

describe('a tier’s look and the shelf (DARK-14)', () => {
	it('takes a background, a border and an icon from its menu', () => {
		rankAlbums()
		fireEvent.click(within(band('Often')).getByRole('button', { name: 'Often options' }))
		fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Often background' })).getByRole('radio', { name: 'Plum' }))
		fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Often border' })).getByRole('radio', { name: 'Rose' }))
		fireEvent.click(screen.getByRole('radio', { name: 'Trophy' }))
		expect(ranking().tiers[1]).toMatchObject({ color: 'plum', border: 'rose', icon: 'trophy' })
		expect(band('Often').style.getPropertyValue('--lb-tier-bg')).toBe('#7a3f8c')
		expect(band('Often').style.getPropertyValue('--lb-tier-border')).toBe('#a8436a')
		fireEvent.click(screen.getByRole('radio', { name: 'No icon' }))
		expect(ranking().tiers[1]!.icon).toBe('')
	})

	it('draws as a bookcase, a shelf a tier with the crate on top, and still moves covers by dragging', () => {
		stampAlbums({ 'Album 1': 'liked' })
		rankAlbums()
		fireEvent.click(within(within(card()).getByRole('group', { name: 'Display' })).getByRole('button', { name: 'Shelf' }))
		expect(ranking().display).toBe('shelf')
		expect(card().classList.contains('lb-rank--shelf')).toBe(true)
		expect(within(card()).getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual([
			'Rank queue, 1 waiting',
			'Heavy rotation tier',
			'Often tier',
			'Now and then tier',
			'Rarely tier',
		])
		expect(within(band('Often')).getByText('Often')).toBeTruthy()

		const drag = dataTransfer()
		fireEvent.dragStart(within(within(card()).getByRole('list', { name: 'Rank queue' })).getAllByRole('listitem')[0]!, { dataTransfer: drag })
		fireEvent.dragOver(band('Rarely'), { dataTransfer: drag })
		fireEvent.drop(band('Rarely'), { dataTransfer: drag })
		expect(coversIn('Rarely')).toEqual(['a1'])
		// It settles with a wobble.
		expect(within(band('Rarely')).getAllByRole('listitem')[0]!.className).toMatch(/lb-rank__cover--settle/)

		fireEvent.click(within(card()).getByRole('button', { name: 'Tiers' }))
		expect(ranking().display).toBe('tiers')
	})
})
