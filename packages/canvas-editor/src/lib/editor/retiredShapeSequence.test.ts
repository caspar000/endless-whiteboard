import { createMigrationSequence } from '@tldraw/store'
import { describe, expect, it } from 'vitest'
import { createTLStore } from '../config/createTLStore'
import { Editor } from './Editor'
import { retiredShapeSequence } from './retiredShapeSequence'

const editorOver = (sequence: ReturnType<typeof createMigrationSequence>) =>
	new Editor({
		shapeUtils: [],
		tools: [],
		store: createTLStore({ shapeUtils: [], migrations: [sequence] }),
		getContainer: () => document.body,
	})

describe('a retired shape type’s sequence', () => {
	it('lets the editor start without a util for the type', () => {
		expect(() => editorOver(retiredShapeSequence('node.gone')).dispose()).not.toThrow()
	})

	it('is needed: an unmarked empty sequence reads as a shape type without a util', () => {
		const plain = createMigrationSequence({ sequenceId: 'com.tldraw.shape.node.gone', sequence: [] })
		expect(() => editorOver(plain)).toThrow(/"node.gone" is present in the store schema/)
	})
})
