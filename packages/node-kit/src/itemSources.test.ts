import { afterEach, describe, expect, it } from 'vitest'
import {
	ITEM_DRAG_TYPE,
	clearItemSources,
	getDraggedItem,
	isSourceShapeType,
	offeredItemSources,
	registerItemSource,
	resolveItemSource,
	sourceEntries,
	sourceKeyOfShape,
	type ItemSource,
} from './itemSources'
import { setExtensionEnabled } from './registry'

const source = (id: string, entries: (choiceId: string) => ReturnType<ItemSource['entries']>, extra: Partial<ItemSource> = {}): ItemSource => ({
	id,
	label: id,
	choices: () => [{ id: 'a', label: `${id} a`, group: '' }],
	entries,
	kind: () => ({ noun: 'items', one: 'item', creator: 'Creator', tag: '', shape: 'square' }),
	...extra,
})

const entry = (id: string) => ({ id, title: id, creator: '', year: '', cover: '', url: '' })

afterEach(() => {
	clearItemSources()
	setExtensionEnabled('ext.off', true)
})

describe('the kit’s sources', () => {
	it('resolves a key, and calls one whose source is not registered missing', () => {
		registerItemSource(source('shelf', () => [entry('1')]))
		expect(resolveItemSource('shelf:a')).toMatchObject({ type: 'source', name: 'shelf a' })
		expect(resolveItemSource('gone:a').type).toBe('missing')
		expect(resolveItemSource('').type).toBe('none')
	})

	it('offers only the sources whose extension is on', () => {
		registerItemSource(source('on', () => []))
		registerItemSource(source('off', () => [], { extensionId: 'ext.off' }))
		setExtensionEnabled('ext.off', false)
		expect(offeredItemSources().map((s) => s.id)).toEqual(['on'])
	})

	it('stops a source made of sources that holds itself, rather than looping', () => {
		// A backlog holding a ranking of that same backlog.
		registerItemSource(source('backlog', () => [entry('typed'), ...sourceEntries('ranking:a')]))
		registerItemSource(source('ranking', () => sourceEntries('backlog:a').map((e) => ({ ...e, id: `r-${e.id}` }))))
		// Read from inside itself, the backlog has nothing: the ranking in it adds nothing more.
		expect(sourceEntries('backlog:a').map((e) => e.id)).toEqual(['typed'])
		// Read first, the ranking ranks the backlog once.
		expect(sourceEntries('ranking:a').map((e) => e.id)).toEqual(['r-typed'])
	})

	it('knows which source a card on the board stands for', () => {
		registerItemSource(
			source('syllabus', () => [], { fromShape: { types: ['node.track'], choiceOf: (shape) => (shape.props as { trackId: string }).trackId || null } })
		)
		const track = { type: 'node.track', props: { trackId: 'mucore' } } as never
		expect(isSourceShapeType('node.track')).toBe(true)
		expect(isSourceShapeType('node.sticky')).toBe(false)
		expect(sourceKeyOfShape(track)).toBe('syllabus:mucore')
		expect(sourceKeyOfShape({ type: 'node.track', props: { trackId: '' } } as never)).toBeNull()
	})
})

describe('an item dragged between cards', () => {
	const transfer = (value: string) => ({ getData: (type: string) => (type === ITEM_DRAG_TYPE ? value : '') }) as unknown as DataTransfer

	it('reads back what was put on the drag', () => {
		const item = { entry: { ...entry('x'), title: 'Loveless', creator: 'My Bloody Valentine' }, from: 'feeds:all', via: 'Feeds' }
		expect(getDraggedItem(transfer(JSON.stringify(item)))).toEqual(item)
	})

	it('refuses what is not an item, as it may come from another tab or build', () => {
		expect(getDraggedItem(transfer('not json'))).toBeNull()
		expect(getDraggedItem(transfer(JSON.stringify({ entry: { id: 'x' } })))).toBeNull()
		expect(getDraggedItem(transfer(JSON.stringify({ entry: { title: 'No id' } })))).toBeNull()
	})
})
