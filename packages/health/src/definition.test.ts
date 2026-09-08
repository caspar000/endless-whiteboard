import { describe, expect, it } from 'vitest'
import { healthDefinitions } from './definition'
import { containsPrivateImageContent } from '../../node-kit/src/ops/view'
import { defineNode, registerExtension } from '@lifeboard/node-kit'
import type { Editor, TLShape } from 'tldraw'

describe('health nodes', () => {
  it('registers a migration and scalar configuration for every metric without storing readings', () => {
    expect(healthDefinitions).toHaveLength(13)
    expect(new Set(healthDefinitions.map(d => d.type)).size).toBe(13)
    for (const definition of healthDefinitions) {
      expect(definition.migrations).toBeDefined()
      const props = definition.defaultProps()
      expect(props).not.toHaveProperty('records')
      for (const [key, validator] of Object.entries(definition.props)) expect(() => validator.validate(props[key as keyof typeof props])).not.toThrow()
      expect(definition.excludeFromAgentImages).toBe(true)
    }
  })
  it('blocks agent images of health cards and containing frames but permits unrelated selections', () => {
    registerExtension({ id: 'lifeboard.health', name: 'Apple Health', nodes: healthDefinitions.map(defineNode) })
    const frame = { id: 'shape:frame', type: 'frame', parentId: 'page:page' } as TLShape
    const card = { id: 'shape:health', type: 'node.health.steps', parentId: frame.id } as TLShape
    const note = { id: 'shape:note', type: 'note', parentId: 'page:page' } as TLShape
    const editor = { getCurrentPageShapes: () => [frame, card, note] } as unknown as Editor
    expect(containsPrivateImageContent(editor, [card])).toBe(true)
    expect(containsPrivateImageContent(editor, [frame])).toBe(true)
    expect(containsPrivateImageContent(editor, [note])).toBe(false)
  })
})
