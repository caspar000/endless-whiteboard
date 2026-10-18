import { describe, expect, it } from 'vitest'
import adlerYaml from '../content/adler.yaml?raw'
import directorYaml from '../content/director.yaml?raw'
import mucoreYaml from '../content/mucore.yaml?raw'
import lifeYaml from '../content/whole-life-test.yaml?raw'
import filmYaml from '../content/film.yaml?raw'
import theatreYaml from '../content/theatre.yaml?raw'
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

	it('lists an item in a second track by reference, and every reference resolves', () => {
		const ids = new Set(doc.tracks.flatMap((t) => t.items.map((i) => i.itemId)))
		expect(track('western-theatre').order).toContain('director/aristotle-poetics')
		for (const t of doc.tracks) for (const id of t.order) expect(ids.has(id), `${t.trackId} → ${id}`).toBe(true)
	})

	it('gives each of the eight stagecraft disciplines its games and exercises', () => {
		const disciplines = track('stagecraft').items.filter((i) => i.itemId.startsWith('director/stagecraft-'))
		expect(disciplines).toHaveLength(8)
		for (const d of disciplines) expect(d.children.filter((c) => c.medium === 'game'), d.title).toHaveLength(3)
	})

	it('has a tree that holds together, hung under the Practical pillar', () => {
		checkTree(doc)
		expect(doc.trees[0]!.mount).toBe('mastery/practical')
	})

	it("holds Schreiber's twenty Levels", () => {
		const course = track('game-design').items.find((i) => i.itemId === 'director/schreiber-game-design-concepts')!
		expect(course.children.map((c) => c.title.split(':')[0])).toEqual(Array.from({ length: 20 }, (_, i) => `Level ${i + 1}`))
	})
})

describe('content/whole-life-test.yaml', () => {
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

describe('content/film.yaml', () => {
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

describe('content/theatre.yaml', () => {
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
