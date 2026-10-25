import { describe, expect, it } from 'vitest'
import { parseRequirements } from '@lifeboard/skill-tree'
import { parseSyllabus, type SyllabusDoc } from './syllabusYaml'

const SOURCE = `
goal: adler
name: Western canon reader
tracks:
  - id: greeks
    name: The Greeks
    state: active
    defaultTags: [canon]
    items:
      - id: homer
        title: Homer
        kind: study
        medium: book
        tags: [greek-epic]
        childRule: all
        children:
          - { id: iliad, title: Iliad }
          - { id: odyssey, title: Odyssey }
      - director/poetics-notes
tree:
  id: adler
  layout: lineage
  nodes:
    - { id: start, name: Start with the Greeks, kind: root }
    - id: greek-epic
      name: Epic
      icon: sword
      requires:
        - node: [start]
        - item: homer
`

function parsed(source: string): SyllabusDoc {
	const result = parseSyllabus(source)
	if (!result.ok) throw new Error(result.errors.join('\n'))
	return result.doc
}

describe('parseSyllabus', () => {
	it('qualifies item ids with the goal, and children with their parent', () => {
		const doc = parsed(SOURCE)
		const homer = doc.tracks[0]!.items[0]!
		expect(homer.itemId).toBe('adler/homer')
		expect(homer.kind).toBe('Study')
		expect(homer.childRule).toBe('all')
		expect(homer.children.map((c) => c.itemId)).toEqual(['adler/homer/iliad', 'adler/homer/odyssey'])
	})

	it('keeps ids that already name a goal, and lists them in the order', () => {
		const track = parsed(SOURCE).tracks[0]!
		expect(track.trackId).toBe('adler/greeks')
		expect(track.order).toEqual(['adler/homer', 'director/poetics-notes'])
		expect(track.items).toHaveLength(1)
	})

	it('qualifies tags and default tags with the tree', () => {
		const doc = parsed(SOURCE)
		expect(doc.tracks[0]!.items[0]!.tags).toEqual(['adler/greek-epic'])
		expect(doc.tracks[0]!.defaultTags).toEqual(['adler/canon'])
	})

	it('qualifies every reference inside requirements', () => {
		const node = parsed(SOURCE).trees[0]!.nodes[1]!
		expect(node.icon).toBe('sword')
		const requires = parseRequirements(node.requires)
		expect(requires.ok && requires.conditions).toEqual([
			{ key: 'node', value: ['adler/start'] },
			{ key: 'item', value: 'adler/homer' },
		])
	})

	it('collects every problem instead of stopping at the first', () => {
		const result = parseSyllabus(`
tracks:
  - id: t
    items:
      - { id: x, kind: lecture }
tree:
  id: t
  nodes:
    - { id: n, name: N, requires: [{ habit: { id: h } }] }
`)
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.errors).toHaveLength(3)
		expect(result.errors[0]).toMatch(/goal is required/)
		expect(result.errors[1]).toMatch(/Track 1 › item 1: kind is one of/)
		expect(result.errors[2]).toMatch(/unknown requirement "habit"/)
	})

	it('reads several trees, each qualifying its own nodes, and their mounts', () => {
		const doc = parsed(`
goal: mastery
name: Mastery
trees:
  - id: mastery
    nodes:
      - { id: root, name: Mastery, kind: mastery }
      - { id: mental, name: Mental, kind: pillar, requires: [ { node: [root] } ] }
  - id: mind
    name: Mind
    mount: mental
    nodes:
      - { id: focus, name: Deep Focus, kind: root }
      - { id: memory, name: Memory, requires: [ { node: [focus] } ] }
`)
		expect(doc.trees.map((t) => [t.treeId, t.mount])).toEqual([
			['mastery', ''],
			['mind', 'mastery/mental'],
		])
		expect(doc.trees[1]!.nodes.map((n) => n.nodeId)).toEqual(['mind/focus', 'mind/memory'])
		expect(parseRequirements(doc.trees[1]!.nodes[1]!.requires)).toMatchObject({ ok: true, conditions: [{ key: 'node', value: ['mind/focus'] }] })
		expect(doc.trees[0]!.nodes[0]!.kind).toBe('mastery')
	})

	it('wants an id on every tree after the first', () => {
		const result = parseSyllabus('goal: g\ntrees:\n  - nodes: []\n  - nodes: []\n')
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.errors).toEqual(['Tree 2: a tree after the first needs an id'])
	})

	it('reports YAML syntax errors with their line', () => {
		const result = parseSyllabus('goal: adler\ntracks: [\n')
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.errors[0]).toMatch(/^Line \d+: /)
	})
})
