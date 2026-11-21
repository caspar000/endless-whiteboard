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
		expect(rankingSource.choices()).toEqual([])

		fireEvent.click(within(card()).getByRole('button', { name: 'Ranking settings' }))
		fireEvent.click(screen.getByRole('checkbox', { name: /Weighted shuffle/ }))
		// 4×1, 3×2, 1×1 of 11: Heavy rotation 1 in 3, Often 1 in 2, Rarely 1 in 11.
		expect(within(band('Heavy rotation')).getByText('1 in 3')).toBeTruthy()
		expect(within(band('Often')).getByText('1 in 2')).toBeTruthy()
		expect(within(band('Rarely')).getByText('1 in 11')).toBeTruthy()
		expect(rankingSource.choices().map((c) => c.id)).toEqual(['r1'])
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
		expect(heard).toEqual([{ entry: albums[3], from: ALBUMS, rankingId: 'r1' }])

		// Between tiers, or back to the rail, it is already ranked.
		fireEvent.keyDown(within(band('Often')).getAllByRole('listitem')[0]!, { key: 'ArrowUp' })
		fireEvent.keyDown(within(band('Heavy rotation')).getAllByRole('listitem')[0]!, { key: 'ArrowDown' })
		expect(heard).toHaveLength(1)
	})

	it('shows stamp badges, hides the stamps switched off, and shapes its covers', () => {
		const stamps: Record<string, string> = { 'Album 1': 'liked', 'Album 2': 'disliked' }
		registerItemStamps({
			sourceId: 'stamped',
			kinds: [
				{ id: 'liked', label: 'Liked', ink: '#2f9e44' },
				{ id: 'disliked', label: 'Disliked', ink: '#e03131' },
				{ id: 'unsure', label: 'Unsure', ink: '#f08c00' },
			],
			stampOf: (e) => (stamps[e.title] ? { kind: stamps[e.title]!, date: '2026-11-01' } : null),
		})
		rankAlbums()
		act(() => rankings.put('r1', { ...ranking(), placed: { [ALBUMS]: { t1: ['a1', 'a2', 'a3'] } } }))
		expect(within(band('Heavy rotation')).getAllByRole('listitem')[0]!.getAttribute('aria-label')).not.toMatch(/Stamped/)

		fireEvent.click(within(card()).getByRole('button', { name: 'Ranking settings' }))
		fireEvent.click(screen.getByRole('checkbox', { name: /Stamp badges/ }))
		expect(within(band('Heavy rotation')).getAllByRole('listitem')[0]!.getAttribute('aria-label')).toMatch(/Stamped Liked/)

		fireEvent.click(screen.getByRole('checkbox', { name: 'Disliked' }))
		expect(coversIn('Heavy rotation')).toEqual(['a1', 'a3'])
		fireEvent.click(screen.getByRole('checkbox', { name: 'Disliked' }))
		expect(coversIn('Heavy rotation')).toEqual(['a1', 'a2', 'a3'])

		fireEvent.change(screen.getByLabelText('Cover shape'), { target: { value: '16:9' } })
		expect(ranking().aspect).toBe('16:9')
		expect(card().style.getPropertyValue('--lb-rank-aspect')).toBe(String(16 / 9))
	})

	it('stamps Liked what it ranks from a stamped list, and keeps it in the tier it was put in', () => {
		// The randomizer's stamped lists, as it offers them: an item is in the list of its latest stamp.
		const latest = atom<Record<string, string>>('test:stamps', { 'Album 1': 'unsure', 'Album 2': 'unsure', 'Album 3': 'liked' })
		const KINDS = [
			{ id: 'liked', label: 'Liked', ink: '#2f9e44' },
			{ id: 'disliked', label: 'Disliked', ink: '#e03131' },
			{ id: 'unsure', label: 'Unsure', ink: '#f08c00' },
		]
		registerItemSource({
			id: 'stamped',
			label: 'Randomizer stamps',
			choices: () => KINDS.map((k) => ({ id: k.id, label: `Everything ${k.label}`, group: '' })),
			entries: (kind) => albums.filter((a) => latest.get()[a.title] === kind),
			kind: () => ({ noun: 'items', one: 'item', creator: 'Creator', tag: '', shape: 'square' }),
		})
		registerItemStamps({ sourceId: 'stamped', kinds: KINDS, stampOf: (e) => (latest.get()[e.title] ? { kind: latest.get()[e.title]!, date: '2026-11-01' } : null) })
		registerItemReaction({ id: 'test.like', ranked: ({ entry }) => latest.set({ ...latest.get(), [entry.title]: 'liked' }) })

		render(<Board rankingId="r1" />)
		fireEvent.click(within(card()).getByRole('button', { name: 'Choose what to rank' }))
		fireEvent.change(screen.getByLabelText('Rank from'), { target: { value: 'stamped:unsure' } })
		fireEvent.click(screen.getByRole('button', { name: 'Done' }))
		fireEvent.click(within(card()).getByRole('button', { name: /^Unranked/ }))
		fireEvent.change(within(card()).getByRole('searchbox', { name: 'Search unranked' }), { target: { value: 'Album 2' } })
		const drag = dataTransfer()
		fireEvent.dragStart(within(screen.getByRole('list', { name: 'Unranked' })).getAllByRole('listitem')[0]!, { dataTransfer: drag })
		fireEvent.dragOver(band('Often'), { dataTransfer: drag })
		fireEvent.drop(band('Often'), { dataTransfer: drag })

		expect(latest.get()['Album 2']).toBe('liked')
		expect(coversIn('Often')).toEqual(['a2'])
		// The rest of the list is as it was: Album 1 still waits, and Album 3, Liked but never ranked here, isn't brought in.
		fireEvent.change(within(card()).getByRole('searchbox', { name: 'Search unranked' }), { target: { value: '' } })
		expect(within(screen.getByRole('list', { name: 'Unranked' })).getAllByRole('listitem').map((el) => el.getAttribute('data-item-id'))).toEqual(['a1'])

		// Liked switched on brings in every Liked item; switched off by hand, it hides the ranked one too,
		// keeping its tier for when it is switched on again.
		fireEvent.click(within(card()).getByRole('button', { name: 'Ranking settings' }))
		const liked = () => screen.getByRole('checkbox', { name: 'Liked' })
		expect(liked()).toHaveProperty('checked', false)
		fireEvent.click(liked())
		expect(within(screen.getByRole('list', { name: 'Unranked' })).getAllByRole('listitem').map((el) => el.getAttribute('data-item-id'))).toEqual(['a1', 'a3'])
		fireEvent.click(liked())
		expect(coversIn('Often')).toEqual([])
		fireEvent.click(liked())
		expect(coversIn('Often')).toEqual(['a2'])
	})
})
