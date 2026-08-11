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

const asset = (src: unknown) => ({
	typeName: 'asset',
	id: 'asset:1',
	props: { src },
})

describe('collectAssetRefs', () => {
	it('collects the hashes of managed assets', () => {
		const refs = collectAssetRefs(
			snapshot(asset('asset:aaa'), asset('asset:bbb'), {
				typeName: 'shape',
				type: 'image',
			})
		)
		expect([...refs.hashes].sort()).toEqual(['aaa', 'bbb'])
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
		const refs = collectAssetRefs(snapshot(asset('asset:aaa'), asset('')))
		expect([...refs.hashes]).toEqual(['aaa'])
		expect(refs.pending).toBe(true)
	})

	it('survives records written by an older app version', () => {
		expect(() =>
			collectAssetRefs(snapshot(null, 'not-a-record', 42, { typeName: 'asset' }, {}))
		).not.toThrow()
	})
})
