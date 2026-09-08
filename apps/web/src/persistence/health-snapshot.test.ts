import '../extensions'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { createNodeShapeUtil, getNodeDefinitions, itemsToNotesMigrations, rollupsToTablesMigrations } from '@lifeboard/node-kit'
import { createTLStore, defaultBindingUtils, defaultShapeUtils, loadSnapshot, type TLStoreSnapshot } from 'tldraw'

const fixture = fileURLToPath(new URL('./fixtures/health/v0.1.0-health.json', import.meta.url))
function makeStore() {
  return createTLStore({ shapeUtils: [...defaultShapeUtils, ...getNodeDefinitions().map(createNodeShapeUtil)], bindingUtils: defaultBindingUtils, migrations: [itemsToNotesMigrations, rollupsToTablesMigrations] })
}
it('round-trips every health card through the current application schema without readings', () => {
  const store = makeStore()
  const health = getNodeDefinitions().filter(d => d.type.startsWith('node.health.'))
  const snapshot = JSON.parse(readFileSync(fixture, 'utf8')) as TLStoreSnapshot
  loadSnapshot(store, snapshot)
  const cards = store.allRecords().filter(r => r.typeName === 'shape')
  expect(cards).toHaveLength(13)
  expect(new Set(cards.map(r => r.type))).toEqual(new Set(health.map(d => d.type)))
  for (const card of cards) {
    expect(snapshot.store[card.id]).toMatchObject({ props: card.props })
    expect(card.props).not.toHaveProperty('records')
    expect(card.meta).toEqual({})
  }
})
