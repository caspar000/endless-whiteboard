import { describe, expect, it } from 'vitest'
import { collectAssetRefs } from './assetRefs'
import type { RawBoardSnapshot } from './tldrawLocalDb'

function snapshot(...records: unknown[]): RawBoardSnapshot {
	const store: Record<string, unknown> = {}
	records.forEach((record, i) => {
		store[`record:${i}`] = record
	})
	return { store, schema: {} }
}

/** Real hashes are 64 hex characters, and only those count — see `isManagedAssetSrc`. */
const AAA = 'a'.repeat(64)
const BBB = 'b'.repeat(64)
const CAFE = 'c'.repeat(64)
const FACADE = 'f'.repeat(64)

const asset = (src: unknown) => ({
	typeName: 'asset',
	id: 'asset:1',
	props: { src },
})

describe('collectAssetRefs', () => {
	it('collects the hashes of managed assets', () => {
		const refs = collectAssetRefs(
			snapshot(asset(`asset:${AAA}`), asset(`asset:${BBB}`), {
				typeName: 'shape',
				type: 'image',
			})
		)
		expect([...refs.hashes].sort()).toEqual([AAA, BBB])
		expect(refs.pending).toBe(false)
	})

	it('ignores foreign sources rather than treating them as pending', () => {
		// A bookmark's remote thumbnail has a real src that simply isn't ours. Reporting it as pending
		// would abstain from every sweep on any board holding a bookmark.
		const refs = collectAssetRefs(snapshot(asset('https://example.com/og.png')))
		expect(refs.hashes.size).toBe(0)
		expect(refs.pending).toBe(false)
	})

	it('reports an empty src as pending, because tldraw writes the record before the upload lands', () => {
		expect(collectAssetRefs(snapshot(asset(''))).pending).toBe(true)
		expect(collectAssetRefs(snapshot(asset(null))).pending).toBe(true)
		expect(collectAssetRefs(snapshot({ typeName: 'asset', props: {} })).pending).toBe(true)
	})

	it('still reports the hashes it did find alongside a pending one', () => {
		// GC abstains on `pending`, but export needs the known hashes regardless.
		const refs = collectAssetRefs(snapshot(asset(`asset:${AAA}`), asset('')))
		expect([...refs.hashes]).toEqual([AAA])
		expect(refs.pending).toBe(true)
	})

	it('survives records written by an older app version', () => {
		expect(() =>
			collectAssetRefs(snapshot(null, 'not-a-record', 42, { typeName: 'asset' }, {}))
		).not.toThrow()
	})

	it('collects asset srcs held in shape props, where extension nodes keep them', () => {
		// A book node references its file and cover directly from props — no asset record exists.
		// GC and backup export must see those hashes or they would sweep a book's bytes.
		const refs = collectAssetRefs(
			snapshot({
				typeName: 'shape',
				type: 'node.book',
				props: { fileSrc: `asset:${FACADE}`, coverSrc: `asset:${CAFE}`, title: 'Dune', pageCount: 412 },
			})
		)
		expect([...refs.hashes].sort()).toEqual([CAFE, FACADE])
		expect(refs.pending).toBe(false)
	})

	it('finds srcs nested inside shape prop objects and arrays', () => {
		const refs = collectAssetRefs(
			snapshot({
				typeName: 'shape',
				type: 'node.future',
				props: { gallery: [{ src: `asset:${AAA}` }, { src: `asset:${BBB}` }] },
			})
		)
		expect([...refs.hashes].sort()).toEqual([AAA, BBB])
	})

	it('does not treat shape props as pending, and ignores non-asset strings in them', () => {
		const refs = collectAssetRefs(
			snapshot({ typeName: 'shape', type: 'node.book', props: { fileSrc: '', title: 'asset-ish' } })
		)
		expect(refs.hashes.size).toBe(0)
		// Extension nodes store bytes *before* creating the shape, so an empty src means "no file",
		// never "upload in flight" — unlike an asset record's empty src.
		expect(refs.pending).toBe(false)
	})
	it('does not mistake tldraw asset record ids for blobs', () => {
		// An image shape points at its asset *record*, whose id also starts with `asset:`.
		const refs = collectAssetRefs(
			snapshot({ typeName: 'shape', type: 'image', props: { assetId: 'asset:2038128137' } })
		)
		expect(refs.hashes.size).toBe(0)
	})
})
