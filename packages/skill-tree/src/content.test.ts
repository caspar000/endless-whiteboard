import { describe, expect, it } from 'vitest'
import adlerYaml from '../../../syllabi/adler.yaml?raw'
import mucoreYaml from '../../../syllabi/mucore.yaml?raw'
import filmYaml from '../../../syllabi/film.yaml?raw'
import theatreYaml from '../../../syllabi/theatre.yaml?raw'
import gamesYaml from '../../../syllabi/games.yaml?raw'
import lifeYaml from '../fixtures/whole-life-test.yaml?raw'
import { parseRequirements } from './requirements'
import { parseSyllabus, type DocItem } from './syllabusYaml'
import { prerequisitesOf } from './tree/prerequisites'

/** The syllabi in syllabi/ at the repo root, and the whole-life fixture: they parse, and their trees hold together. */
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
			const count = c.value as { min: number; method?: string }
			if (c.key !== 'count' || count.method) continue
			const available = items.filter((i) => i.tags.includes(node.nodeId)).reduce((n, i) => n + leaves(i), 0)
			expect(count.min, node.nodeId).toBeLessThanOrEqual(available)
		}
	}
}

const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
const leaves = (item: DocItem): number => (item.children.length ? item.children.reduce((n, c) => n + leaves(c), 0) : 1)

describe('syllabi/adler.yaml', () => {
	const doc = load(adlerYaml)
	const items = doc.tracks[0]!.items
	const tree = doc.trees[0]!
	const nodeIds = new Set(tree.nodes.map((n) => n.nodeId))

	it('holds all 137 entries, in order, as one track', () => {
		expect(doc.tracks).toHaveLength(1)
		expect(items).toHaveLength(137)
		expect(items.map((i) => i.itemId.slice(6, 9))).toEqual(Array.from({ length: 137 }, (_, i) => String(i + 1).padStart(3, '0')))
	})

	it('names each entry by its author, and keeps the ids it has always had', () => {
		expect(items[4]!.title).toBe('Herodotus')
		expect(items[4]!.children.map((c) => c.title)).toEqual(['History'])
		expect(items[9]!.title).toBe('Plato')
	})

	it('keeps the node ids it has always had', () => {
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
				const count = c.value as { min: number; method?: string }
				if (c.key !== 'count' || count.method) continue
				const available = items.filter((i) => i.tags.includes(node.nodeId)).reduce((n, i) => n + leaves(i), 0)
				expect(count.min, node.nodeId).toBeLessThanOrEqual(available)
			}
		}
	})
})

describe('syllabi/mucore.yaml', () => {
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

describe('fixtures/whole-life-test.yaml', () => {
	const doc = load(lifeYaml)
	const nodes = new Map(doc.trees.flatMap((t) => t.nodes.map((n) => [n.nodeId, t.treeId] as const)))

	it('puts you at the centre of five pillars, and a tree on each of the other four', () => {
		const mastery = doc.trees.find((t) => t.treeId === 'mastery')!
		expect(mastery.nodes.filter((n) => n.kind === 'pillar').map((n) => n.name)).toEqual(['Physical', 'Mental', 'Spiritual', 'Practical', 'Social'])
		const mounts = new Set(doc.trees.map((t) => t.mount).filter(Boolean))
		expect([...mounts].sort()).toEqual(['mastery/mental', 'mastery/physical', 'mastery/social', 'mastery/spiritual'])
	})

	it('tags every item to a node it has, and requires only nodes it has', () => {
		for (const item of doc.tracks.flatMap((t) => t.items)) for (const tag of item.tags) expect(nodes.has(tag), `${item.title} → ${tag}`).toBe(true)
		for (const tree of doc.trees)
			for (const node of tree.nodes) for (const id of prerequisitesOf(node.requires)) expect(nodes.has(id), `${node.nodeId} → ${id}`).toBe(true)
	})

	it('shares Steady Attention between Meditation and Attention', () => {
		const steady = doc.trees.find((t) => t.treeId === 'meditation')!.nodes.find((n) => n.nodeId === 'meditation/steady-attention')!
		expect(prerequisitesOf(steady.requires).map((id) => nodes.get(id))).toEqual(['meditation', 'attention'])
	})
})

describe('syllabi/film.yaml', () => {
	const doc = load(filmYaml)
	const entries = doc.tracks.flatMap((t) => t.items)

	it('has a tree that holds together, hung under the Practical pillar', () => {
		checkTree(doc)
		expect(doc.trees[0]!.mount).toBe('mastery/practical')
	})

	it('keeps every skill node to a dozen entries or so, each a person with their works', () => {
		const per = new Map<string, number>()
		for (const e of entries) per.set(e.tags[0]!, (per.get(e.tags[0]!) ?? 0) + 1)
		for (const [node, n] of per) expect(n, node).toBeLessThanOrEqual(12)
		const tarkovsky = entries.find((e) => e.itemId === 'film/tarkovsky')!
		expect(tarkovsky.title).toBe('Андрей Тарковский')
		expect(tarkovsky.children.map((c) => c.title)).toContain('Сталкер (1979)')
	})
})

describe('syllabi/theatre.yaml', () => {
	const doc = load(theatreYaml)
	const entries = doc.tracks.flatMap((t) => t.items)

	it('has a tree that holds together, hung under the Practical pillar', () => {
		checkTree(doc)
		expect(doc.trees[0]!.mount).toBe('mastery/practical')
	})

	it('keeps every skill node to a dozen entries or so, Russian and Georgian people under their own names', () => {
		const per = new Map<string, number>()
		for (const e of entries) per.set(e.tags[0]!, (per.get(e.tags[0]!) ?? 0) + 1)
		for (const [node, n] of per) expect(n, node).toBeLessThanOrEqual(12)
		expect(entries.find((e) => e.itemId === 'theatre/stanislavsky')!.title).toBe('Константин Станиславский')
		const sturua = entries.find((e) => e.itemId === 'theatre/sturua')!
		expect(sturua.title).toBe('რობერტ სტურუა')
		expect(sturua.children.map((c) => c.title)).toContain('რიჩარდ III (1979)')
	})
})

describe('syllabi/games.yaml', () => {
	const doc = load(gamesYaml)
	const entries = doc.tracks.flatMap((t) => t.items)

	it('has a tree that holds together, hung under the Practical pillar', () => {
		checkTree(doc)
		expect(doc.trees[0]!.mount).toBe('mastery/practical')
	})

	it('keeps every skill node to a dozen entries or so, each a studio or designer with their games', () => {
		const per = new Map<string, number>()
		for (const e of entries) per.set(e.tags[0]!, (per.get(e.tags[0]!) ?? 0) + 1)
		for (const [node, n] of per) expect(n, node).toBeLessThanOrEqual(12)
		const valve = entries.find((e) => e.itemId === 'games/valve')!
		expect(valve.children.map((c) => c.title)).toEqual(['Half-Life (1998)', 'Portal (2007)', 'Team Fortress 2 (2007)', 'Left 4 Dead (2008)', 'Half-Life: Alyx (2020)'])
		expect(entries.find((e) => e.itemId === 'games/pajitnov')!.title).toBe('Алексей Пажитнов')
	})
})
