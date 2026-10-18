import { describe, expect, it } from 'vitest'
import adlerYaml from '../content/adler.yaml?raw'
import directorYaml from '../content/director.yaml?raw'
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

	it('names each entry by its author, and keeps the ids it has always had', () => {
		expect(items[4]!.title).toBe('Herodotus')
		expect(items[4]!.children.map((c) => c.title)).toEqual(['History'])
		expect(items[9]!.title).toBe('Plato')
	})

	it('keeps the in-app sample ids, so importing it merges with the sample', () => {
		ADLER_SAMPLE.forEach((entry, i) => {
			const id = `adler/${String(i + 1).padStart(3, '0')}-${slug(entry.title)}`
			expect(items[i]!.itemId).toBe(id)
			// The sample's works are still there, by id; an entry may have gained the work its old title named.
			const kids = items[i]!.children.map((c) => c.itemId)
			for (const w of entry.works ?? []) expect(kids).toContain(`${id}/${slug(w.title)}`)
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

describe('content/director.yaml', () => {
	const doc = load(directorYaml)
	const track = (id: string) => doc.tracks.find((t) => t.trackId === `director/${id}`)!

	it("holds Mark Brown's 100 in his order, in chronological clusters", () => {
		const clusters = track('game-design').items.filter((i) => i.itemId.startsWith('director/brown-'))
		const games = clusters.flatMap((c) => c.children)
		expect(games).toHaveLength(100)
		expect(games[0]!.title).toBe('Space Invaders (1978)')
		expect(games[99]!.title).toBe('Shadows of Doubt (2023)')
		const years = games.map((g) => Number(/\((\d{4})\)$/.exec(g.title)![1]))
		expect(years).toEqual([...years].sort((a, b) => a - b))
	})

	it("holds Scorsese's 39 and the directors' poll in rank order", () => {
		const western = track('western-film').items
		const scorsese = western.find((i) => i.itemId === 'director/scorsese-39')!
		expect(scorsese.children).toHaveLength(39)
		expect(scorsese.children[0]!.title).toBe('Metropolis')
		const poll = western.filter((i) => i.itemId.startsWith('director/sight-and-sound-')).flatMap((i) => i.children)
		expect(poll).toHaveLength(104)
		expect(poll[0]!.title).toBe('2001: A Space Odyssey (1968)')
	})

	it('turns each film week into its seven steps', () => {
		const weeks = track('film-weeks').items
		expect(weeks).toHaveLength(16)
		for (const week of weeks) expect(week.children, week.title).toHaveLength(7)
	})

	it("holds Schreiber's twenty Levels", () => {
		const course = track('game-design').items.find((i) => i.itemId === 'director/schreiber-game-design-concepts')!
		expect(course.children.map((c) => c.title.split(':')[0])).toEqual(Array.from({ length: 20 }, (_, i) => `Level ${i + 1}`))
	})
})
