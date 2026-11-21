import { clearItemSources, registerItemSource, type ItemSource } from '@lifeboard/node-kit'
import { afterEach, describe, expect, it } from 'vitest'
import { randomizerNodeDefinition } from './definition'
import { TYPED_SOURCE, sourceKey } from './model'
import { resolveSource } from './sources'

const shelf = (choices: string[]): ItemSource => ({
	id: 'shelf',
	label: 'Shelf',
	choices: () => choices.map((id) => ({ id, label: `Shelf ${id}`, group: '' })),
	entries: (choiceId) => [{ id: `${choiceId}-1`, title: 'One', creator: '', year: '', cover: '', url: '' }],
	kind: () => ({ noun: 'records', one: 'record', creator: 'Band', tag: '', shape: 'square' }),
})

afterEach(clearItemSources)

describe('resolveSource', () => {
	it('knows the typed list and no source without any registered source', () => {
		expect(resolveSource(TYPED_SOURCE)).toMatchObject({ type: 'typed', name: 'My list' })
		expect(resolveSource('')).toMatchObject({ type: 'none' })
	})

	it("names a registered source's choice, with that source's words for its items", () => {
		registerItemSource(shelf(['a']))
		const resolved = resolveSource(sourceKey('shelf', 'a'))
		expect(resolved).toMatchObject({ type: 'source', name: 'Shelf a', choiceId: 'a' })
		expect(resolved.kind.noun).toBe('records')
	})

	it('calls a key missing when its source is not registered or its choice is gone, and keeps it', () => {
		expect(resolveSource(sourceKey('shelf', 'a')).type).toBe('missing')
		registerItemSource(shelf(['b']))
		expect(resolveSource(sourceKey('shelf', 'a'))).toMatchObject({ type: 'missing', choiceId: 'a' })
	})

	it('replaces a source registered again under the same id', () => {
		registerItemSource(shelf(['a']))
		registerItemSource(shelf(['b']))
		expect(resolveSource(sourceKey('shelf', 'a')).type).toBe('missing')
		expect(resolveSource(sourceKey('shelf', 'b')).type).toBe('source')
	})

	it("refuses an id that couldn't be told apart in a key", () => {
		expect(() => registerItemSource({ ...shelf([]), id: 'a:b' })).toThrow()
	})

	it('never mistakes a source called like the typed list for it', () => {
		registerItemSource({ ...shelf(['a']), id: TYPED_SOURCE })
		expect(resolveSource(TYPED_SOURCE).type).toBe('typed')
		expect(resolveSource(sourceKey(TYPED_SOURCE, 'a')).type).toBe('source')
	})
})

describe('the migration from the three lists', () => {
	it('turns a stored card from before into one with a source', () => {
		const props: Record<string, unknown> = {
			list: 'books',
			items: [{ id: 'b', list: 'books', title: 'A book', creator: '', year: '', cover: '', stamps: [] }],
			picks: [{ list: 'books', id: 'b' }],
			autoHeight: true,
		}
		const [step] = randomizerNodeDefinition.migrations.sequence
		;(step as { up: (p: unknown) => void }).up(props)
		expect(props).toEqual({
			source: TYPED_SOURCE,
			items: [{ id: 'b', source: TYPED_SOURCE, title: 'A book', creator: '', year: '', cover: '', stamps: [] }],
			picks: [{ source: TYPED_SOURCE, id: 'b' }],
			autoHeight: true,
		})
	})
})
