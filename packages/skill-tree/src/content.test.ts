import { describe, expect, it } from 'vitest'
import adlerYaml from '../content/adler.yaml?raw'
import mucoreYaml from '../content/mucore.yaml?raw'
import { parseRequirements } from './requirements'
import { ADLER_SAMPLE } from './sample'
import { parseSyllabus, type DocItem } from './syllabusYaml'
import { prerequisitesOf } from './tree/prerequisites'

/** The content files in content/: they parse, and their trees hold together. */
const load = (text: string) => {
	const result = parseSyllabus(text)
	if (!result.ok) throw new Error(result.errors.join('\n'))
	return result.doc
}

/** Every tag names a node, every node is reachable from the root, and no count asks for more than its node can get. */
function checkTree(doc: ReturnType<typeof load>) {
	const items = doc.tracks.flatMap((t) => t.items)
	const tree = doc.trees[0]!
	const nodeIds = new Set(tree.nodes.map((n) => n.nodeId))
	for (const item of items) for (const tag of item.tags) expect(nodeIds.has(tag), `${item.title} → ${tag}`).toBe(true)
	const root = tree.nodes.find((n) => n.kind === 'root')!.nodeId
	const reached = new Set([root])
	for (let grew = true; grew; ) {
		grew = false
		for (const node of tree.nodes) {
			const pre = prerequisitesOf(node.requires)
			if (!reached.has(node.nodeId) && pre.length && pre.every((p) => reached.has(p))) {
				reached.add(node.nodeId)
				grew = true
			}
		}
	}
	expect([...nodeIds].filter((id) => !reached.has(id))).toEqual([])
	for (const node of tree.nodes) {
		const parsed = parseRequirements(node.requires)
		expect(parsed.ok, node.nodeId).toBe(true)
		if (!parsed.ok) continue
		for (const c of parsed.conditions) {
			if (!('count' in c) || c.count.method) continue
			const available = items.filter((i) => i.tags.includes(node.nodeId)).reduce((n, i) => n + leaves(i), 0)
			expect(c.count.min, node.nodeId).toBeLessThanOrEqual(available)
		}
	}
}

const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
const leaves = (item: DocItem): number => (item.children.length ? item.children.reduce((n, c) => n + leaves(c), 0) : 1)

describe('content/adler.yaml', () => {
	const doc = load(adlerYaml)
	const items = doc.tracks[0]!.items
	const tree = doc.trees[0]!
	const nodeIds = new Set(tree.nodes.map((n) => n.nodeId))

	it('holds all 137 entries, in order, as one track', () => {
		expect(doc.tracks).toHaveLength(1)
		expect(items).toHaveLength(137)
		expect(items.map((i) => i.itemId.slice(6, 9))).toEqual(Array.from({ length: 137 }, (_, i) => String(i + 1).padStart(3, '0')))
	})

	it('keeps the in-app sample ids, so importing it merges with the sample', () => {
		ADLER_SAMPLE.forEach((entry, i) => {
			const id = `adler/${String(i + 1).padStart(3, '0')}-${slug(entry.title)}`
			expect(items[i]!.itemId).toBe(id)
			expect(items[i]!.children.map((c) => c.itemId)).toEqual((entry.works ?? []).map((w) => `${id}/${slug(w.title)}`))
		})
		for (const id of ['root', 'inspectional', 'analytical', 'greek-epic-drama', 'greek-philosophy', 'greek-science', 'greek-history', 'reading-habit']) {
			expect(nodeIds.has(`adler/${id}`)).toBe(true)
		}
	})

	it('tags every entry with a node of the tree', () => {
		for (const item of items) {
			expect(item.tags, item.title).toHaveLength(1)
			expect(nodeIds.has(item.tags[0]!), `${item.title} → ${item.tags[0]}`).toBe(true)
		}
	})

	it('reaches every node from the root, and asks no node for more than it can get', () => {
		checkTree(doc)
		const reached = new Set(['adler/root'])
		for (let grew = true; grew; ) {
			grew = false
			for (const node of tree.nodes) {
				const pre = prerequisitesOf(node.requires)
				if (!reached.has(node.nodeId) && pre.length && pre.every((p) => reached.has(p))) {
					reached.add(node.nodeId)
					grew = true
				}
			}
		}
		expect([...nodeIds].filter((id) => !reached.has(id))).toEqual([])
		for (const node of tree.nodes) {
			const parsed = parseRequirements(node.requires)
			expect(parsed.ok, node.nodeId).toBe(true)
			if (!parsed.ok) continue
			for (const c of parsed.conditions) {
				if (!('count' in c) || c.count.method) continue
				const available = items.filter((i) => i.tags.includes(node.nodeId)).reduce((n, i) => n + leaves(i), 0)
				expect(c.count.min, node.nodeId).toBeLessThanOrEqual(available)
			}
		}
	})
})

describe('content/mucore.yaml', () => {
	const doc = load(mucoreYaml)
	const units = doc.tracks[0]!.items

	it('holds every one of the 1111 recordings once, grouped into 84 families in chart order', () => {
		const recordings = units.flatMap((u) => u.children)
		expect(units).toHaveLength(84)
		expect(recordings).toHaveLength(1111)
		expect(new Set(recordings.map((r) => r.itemId)).size).toBe(1111)
		expect(recordings[0]!.title).toMatch(/^Prehistoric: /)
	})

	it('feeds every family node, and the tree holds together', () => {
		const tree = doc.trees[0]!
		const pillars = tree.nodes.filter((n) => n.kind === 'pillar')
		expect(pillars).toHaveLength(16)
		for (const unit of units) expect(unit.tags).toHaveLength(1)
		checkTree(doc)
	})
})
