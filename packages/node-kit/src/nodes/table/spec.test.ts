import { describe, expect, it } from 'vitest'
import { defaultTableProps, frameScopedSource } from './spec'

const frame = { id: 'shape:frame1', type: 'frame' }

describe('frameScopedSource', () => {
	it('aims a new table at the frame it was drawn in, with the frame already chosen', () => {
		const next = frameScopedSource(defaultTableProps(), frame)
		expect(next?.source).toMatchObject({ scope: 'frame', frameId: 'shape:frame1' })
	})

	it('leaves a table on open canvas reading the whole board', () => {
		expect(frameScopedSource(defaultTableProps(), null)).toBeNull()
		// Parented to a node rather than a frame — a table dropped on a kanban lane, say.
		expect(frameScopedSource(defaultTableProps(), { id: 'shape:t', type: 'node.table' })).toBeNull()
	})

	it('never overwrites a source someone has already configured', () => {
		// The case that matters: duplicating or pasting a table runs the creation hook too.
		const props = defaultTableProps()
		const connected = { ...props, source: { ...props.source, scope: 'connected' as const } }
		expect(frameScopedSource(connected, frame)).toBeNull()
		const otherFrame = { ...props, source: { ...props.source, frameId: 'shape:frame2' } }
		expect(frameScopedSource(otherFrame, frame)).toBeNull()
	})
})
