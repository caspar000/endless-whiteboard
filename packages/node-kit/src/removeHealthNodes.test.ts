import { describe, expect, it } from 'vitest'
import { REMOVE_HEALTH_NODES_MIGRATION_ID, removeHealthNodesMigrations } from './removeHealthNodes'

const entry = removeHealthNodesMigrations.sequence.find(
	(m) => 'id' in m && m.id === REMOVE_HEALTH_NODES_MIGRATION_ID
) as { up: (store: Record<string, unknown>) => void }

function up(store: Record<string, Record<string, unknown>>) {
	entry.up(store)
	return Object.keys(store).sort()
}

const shape = (id: string, type: string, parentId = 'page:page') => ({ id, typeName: 'shape', type, parentId })
const binding = (id: string, fromId: string, toId: string) => ({ id, typeName: 'binding', type: 'arrow', fromId, toId })

describe('removeHealthNodes', () => {
	it('deletes health shapes, their descendants and bindings that touch them', () => {
		const store = {
			'page:page': { id: 'page:page', typeName: 'page' },
			'shape:card': shape('shape:card', 'node.health.steps'),
			'shape:child': shape('shape:child', 'text', 'shape:card'),
			'shape:grandchild': shape('shape:grandchild', 'text', 'shape:child'),
			'shape:note': shape('shape:note', 'node.markdown'),
			'shape:arrow': shape('shape:arrow', 'arrow'),
			'binding:toCard': binding('binding:toCard', 'shape:arrow', 'shape:card'),
			'binding:toNote': binding('binding:toNote', 'shape:arrow', 'shape:note'),
		}
		expect(up(store)).toEqual(['binding:toNote', 'page:page', 'shape:arrow', 'shape:note'])
	})

	it('leaves a board without health shapes untouched, so a second run is a no-op', () => {
		const store = { 'shape:note': shape('shape:note', 'node.markdown') }
		const before = structuredClone(store)
		up(store)
		expect(store).toEqual(before)
	})
})
