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
	watchSourceKeys,
	type ItemSource,
} from './itemSources'
import { atom } from '@lifeboard/canvas'
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

describe('keeping a list’s sources fresh', () => {
	it('watches what a list holds, follows it as it changes, and lets go of all of it at the end', () => {
		const log: string[] = []
		registerItemSource(
			source('feeds', () => [], {
				choices: () => ['x', 'y'].map((id) => ({ id, label: id, group: '' })),
				watch: (id) => {
					log.push(`+${id}`)
					return () => log.push(`-${id}`)
				},
			})
		)
		const keys = atom<string[]>('keys', ['feeds:x'])
		const release = watchSourceKeys('backlog:b', () => keys.get())
		expect(log).toEqual(['+x'])
		keys.set(['feeds:x', 'feeds:y'])
		keys.set(['feeds:y'])
		expect(log).toEqual(['+x', '+y', '-x'])
		release()
		expect(log).toEqual(['+x', '+y', '-x', '-y'])
	})

	it('doesn’t start a list again from inside itself: a backlog holding a ranking of that backlog', () => {
		let started = 0
		registerItemSource(
			source('backlog', () => [], {
				watch: () => {
					started++
					return watchSourceKeys('backlog:a', () => ['ranking:a'])
				},
			})
		)
		registerItemSource(source('ranking', () => [], { watch: () => watchSourceKeys('ranking:a', () => ['backlog:a']) }))
		const release = watchSourceKeys('card', () => ['backlog:a'])
		expect(started).toBe(1)
		release()
	})
})
