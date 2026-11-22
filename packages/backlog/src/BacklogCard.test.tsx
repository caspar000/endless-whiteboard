import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ITEM_DRAG_TYPE, clearItemMarks, clearItemSources, offeredItemSources, registerItemSource, registerItemStamps, setExtensionEnabled, type SourceEntry } from '@lifeboard/node-kit'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { backlogNodeDefinition } from './definition'
import { itemKey } from './model'
import type { BacklogProps } from './props'
import { BACKLOG_EXTENSION_ID, backlogSource } from './source'
import { backlogs, claimBacklog } from './store'

/*
 * The card as a person uses it, rendered: typed in, a cover dropped on it from another card, a whole
 * syllabus track added and dropped on it as a card, and the backlog then offered to other cards. The
 * syllabus is a source registered here, in the kit's registry, as the Syllabus extension registers its
 * tracks: no other extension is loaded.
 */

const TRACK = 'syllabus:mucore'
const works: SourceEntry[] = Array.from({ length: 30 }, (_, i) => ({ id: `w${i}`, title: `Album ${i}`, creator: 'Band', year: '', cover: '', url: '' }))

const editor = {
	addOpenMenu: () => {},
	deleteOpenMenu: () => {},
	getShapePageBounds: () => ({ x: 0, y: 0, w: 380, h: 400 }),
	getViewportScreenBounds: () => ({ x: 0, y: 0, w: 1440, h: 900 }),
	pageToScreen: (p: { x: number; y: number }) => p,
	getContainer: () => document.body,
}

function mount() {
	const shape = { id: 'shape:bl', type: 'node.backlog', x: 0, y: 0, rotation: 0, props: { backlogId: 'b1', autoHeight: true, w: 380, h: 400 } as BacklogProps, meta: {} }
	const Card = backlogNodeDefinition.component
	render(<Card shape={shape as never} isEditing={false} editor={editor as never} />)
	return shape
}

const card = () => screen.getByLabelText('Backlog')
const tiles = () => within(screen.getByRole('list', { name: 'Backlog items' })).getAllByRole('listitem')
const backlog = () => backlogs.get().b1!

function dataTransfer(item: unknown) {
	const data = new Map<string, string>([[ITEM_DRAG_TYPE, JSON.stringify(item)]])
	return { getData: (type: string) => data.get(type) ?? '', types: [...data.keys()], dropEffect: 'none' }
}

beforeEach(() => {
	registerItemSource(backlogSource)
	registerItemSource({
		id: 'syllabus',
		label: 'Syllabi',
		choices: () => [{ id: 'mucore', label: '/mu/core', group: 'Music listener' }],
		entries: () => works,
		kind: () => ({ noun: 'albums', one: 'album', creator: 'Artist', tag: '', shape: 'square' }),
		fromShape: { types: ['node.track'], choiceOf: (shape) => (shape.props as { trackId: string }).trackId || null },
	})
	backlogs.replace({})
})

afterEach(() => {
	cleanup()
	clearItemSources()
	setExtensionEnabled(BACKLOG_EXTENSION_ID, true)
})

describe('a backlog card', () => {
	it('takes a typed item, with its creator', () => {
		mount()
		expect(within(card()).getByText('Nothing here yet')).toBeTruthy()
		fireEvent.click(within(card()).getByRole('button', { name: 'Add to the backlog' }))
		const field = screen.getByRole('textbox', { name: 'Add an item' })
		fireEvent.change(field, { target: { value: 'Late Spring — Yasujirō Ozu — 1949' } })
		fireEvent.keyDown(field, { key: 'Enter' })
		expect(tiles()).toHaveLength(1)
		expect(within(tiles()[0]!).getByText('Late Spring')).toBeTruthy()
		expect(within(tiles()[0]!).getByText('Yasujirō Ozu')).toBeTruthy()
		expect(within(tiles()[0]!).getByText('typed')).toBeTruthy()
	})

	it('takes a cover dragged from another card, and says where it came from', () => {
		mount()
		const drag = dataTransfer({ entry: { id: 'v1', title: 'Solaris', creator: 'Andrei Tarkovsky', year: '', cover: '', url: '' }, from: 'feeds:all', via: 'Feeds' })
		fireEvent.dragOver(card(), { dataTransfer: drag })
		fireEvent.drop(card(), { dataTransfer: drag })
		expect(within(tiles()[0]!).getByText('Solaris')).toBeTruthy()
		expect(within(tiles()[0]!).getByText('from Feeds')).toBeTruthy()
		expect(backlog().entries[0]?.id).toBe(itemKey('feeds:all', 'v1'))
	})

	it('keeps a whole syllabus track as one tile, in the same square cell as an album', () => {
		mount()
		fireEvent.click(within(card()).getByRole('button', { name: 'Add to the backlog' }))
		const field = screen.getByRole('textbox', { name: 'Add an item' })
		fireEvent.change(field, { target: { value: 'Mirror' } })
		fireEvent.keyDown(field, { key: 'Enter' })
		fireEvent.change(screen.getByLabelText('Or a whole collection'), { target: { value: TRACK } })

		const [collection, item] = tiles()
		expect(tiles()).toHaveLength(2)
		expect(within(collection!).getByText('/mu/core')).toBeTruthy()
		expect(within(collection!).getByText('30 albums')).toBeTruthy()
		// One cell of the grid, its picture the same square box as an album's: no span, no wide tile.
		for (const tile of [collection!, item!]) {
			expect(tile.querySelectorAll('.lb-backlog__thumb')).toHaveLength(1)
			expect(tile.style.gridColumn).toBe('')
		}
		expect(collection!.className).not.toMatch(/wide/)
		// Its first covers fanned in it, and opened, what it holds.
		expect(collection!.querySelectorAll('.lb-backlog__fan')).toHaveLength(3)
		fireEvent.click(within(collection!).getByRole('button', { name: /a collection of 30 albums/ }))
		expect(within(screen.getByRole('region', { name: '/mu/core: what it holds' })).getByText('+18 more · from Syllabi')).toBeTruthy()
		expect(within(card()).getByText('31')).toBeTruthy()
	})

	it('takes a syllabus track’s card dropped on it, and puts the card back where it was picked up', () => {
		const shape = mount()
		const track = { id: 'shape:track', type: 'node.track', x: 600, y: 40, props: { trackId: 'mucore' } }
		const moved: unknown[] = []
		const boardEditor = {
			getSelectedShapes: () => [track],
			getShape: () => track,
			updateShapes: (partials: unknown[]) => moved.push(...partials),
			inputs: { originPagePoint: { x: 700, y: 60 }, currentPagePoint: { x: 100, y: 80 } },
		}
		const drop = backlogNodeDefinition.drop!
		expect(drop.acceptsType?.('node.track')).toBe(true)
		expect(drop.acceptsType?.('sticky')).toBe(false)
		const target = drop.targetAt({ editor: boardEditor as never, shape: shape as never, point: { x: 100, y: 80 } })
		expect(target?.key).toBe(TRACK)
		act(() => drop.apply({ editor: boardEditor as never, shape: shape as never, shapes: [track as never], target: target! }))
		expect(backlog().entries).toEqual([{ kind: 'collection', id: TRACK, via: 'Syllabi' }])
		// Dragged 600 left and 20 down; it goes back by as much.
		expect(moved).toEqual([{ id: 'shape:track', type: 'node.track', x: 1200, y: 20 }])
		expect(within(tiles()[0]!).getByText('/mu/core')).toBeTruthy()
	})

	it('is a source for other cards on its board while Backlog is on, everything in it at once', () => {
		mount()
		act(() => backlogs.put('b1', { backlogId: 'b1', boardId: 'board-1', name: 'To hear', entries: [{ kind: 'collection', id: TRACK, via: 'Syllabi' }] }))
		expect(backlogSource.choices('board-1')).toEqual([{ id: 'b1', label: 'To hear', group: '' }])
		// Another board's cards are not offered it (DARK-14), though one already on it still reads it.
		expect(backlogSource.choices('board-2')).toEqual([])
		expect(backlogSource.choice?.('b1')).toEqual({ id: 'b1', label: 'To hear', group: '' })
		expect(backlogSource.entries('b1')).toHaveLength(30)
		expect(offeredItemSources().map((s) => s.id)).toContain('backlog')
		act(() => setExtensionEnabled(BACKLOG_EXTENSION_ID, false))
		expect(offeredItemSources().map((s) => s.id)).not.toContain('backlog')
		expect(within(screen.getByLabelText('To hear')).getByText('/mu/core')).toBeTruthy()
	})
})

describe('a backlog from before backlogs had boards (DARK-14)', () => {
	it('belongs to the board that opens showing it, and a stamped list it collected becomes that board’s', () => {
		registerItemStamps({
			sourceId: 'stamped',
			kinds: [{ id: 'liked', label: 'Liked', ink: '#2f9e44' }],
			stampOf: () => null,
			scopeToBoard: (key, boardId) => (key === 'stamped:liked' ? `stamped:liked|${boardId}|*` : null),
		})
		backlogs.put('old', { backlogId: 'old', boardId: '', name: 'Old', entries: [{ kind: 'collection', id: 'stamped:liked', via: 'Randomizer stamps' }, { kind: 'collection', id: TRACK, via: 'Syllabi' }] })
		claimBacklog('old', 'board-1')
		expect(backlogs.one('old')).toMatchObject({ boardId: 'board-1', entries: [{ id: 'stamped:liked|board-1|*' }, { id: TRACK }] })
		clearItemMarks()
	})
})
