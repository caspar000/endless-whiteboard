import { createTLStore, defaultBindingUtils } from '@lifeboard/canvas'
import { STORE_MIGRATIONS } from '@lifeboard/schema'
import { describe, expect, it } from 'vitest'
import { buildBoardShapeUtils, buildStoreShapeUtils } from './boardShapeUtils'
import { canReadSnapshot } from './snapshotVersion'

describe('a board’s records', () => {
	const utils = buildStoreShapeUtils(buildBoardShapeUtils())
	const current = createTLStore({ shapeUtils: utils, bindingUtils: defaultBindingUtils, migrations: STORE_MIGRATIONS }).schema.serialize() as {
		sequences: Record<string, number>
	}

	it('are readable when this version or an older one wrote them', () => {
		expect(canReadSnapshot({ schema: current }, utils)).toBe(true)
		const older = { ...current, sequences: { ...current.sequences, 'com.tldraw.shape.pinned-note': 1 } }
		expect(canReadSnapshot({ schema: older }, utils)).toBe(true)
	})

	it('are not when a newer version wrote them, so the board waits instead of breaking', () => {
		const version = current.sequences['com.tldraw.shape.pinned-note']!
		const newer = { ...current, sequences: { ...current.sequences, 'com.tldraw.shape.pinned-note': version + 1 } }
		expect(canReadSnapshot({ schema: newer }, utils)).toBe(false)
	})
})
