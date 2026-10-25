import { parse as parseYaml, stringify as stringifyYaml, YAMLParseError } from 'yaml'
import { formatChildRule, ITEM_KINDS } from './model'
import { qualifyConditions } from './requirements'

/**
 * The one format for import, export and the agent's drafts (docs/skill-tree-plan.md, "The YAML
 * format"). Pure: text in, a validated document with fully qualified ids out.
 *
 * Ids are written short and qualified on the way in: an item `homer` in goal `adler` is
 * `adler/homer`, its child `iliad` is `adler/homer/iliad`, and a tag or node reference `greek-drama`
 * means the tree's node `adler/greek-drama`. An id that already has a `/` is taken as it is, which
 * is how one goal's track can list another goal's item (the director's Theatre track and Adler's
 * *Poetics*).
 */

export interface DocItem {
	itemId: string
	title: string
	kind: string
	medium: string
	tags: string[]
	core: boolean
	childRule: string
	children: DocItem[]
}

export interface DocTrack {
	trackId: string
	name: string
	state: string
	defaultTags: string[]
	/** Items defined here, in order. */
	items: DocItem[]
	/** The full order, including items defined elsewhere and only named here. */
	order: string[]
}

export interface DocNode {
	nodeId: string
	name: string
	kind: string
	icon: string
	sector: string
	ring: string
	requires: string
}

export interface DocTree {
	treeId: string
	name: string
	goal: string
	layout: string
	sectors: string[]
	rings: string[]
	/** A node of another tree this one hangs from ('' for none). */
	mount: string
	nodes: DocNode[]
}

export interface SyllabusDoc {
	goal: string
	name: string
	tracks: DocTrack[]
	/** `tree:` (one) or `trees:` (several, each with its own id; a tree can `mount:` on another's node). */
	trees: DocTree[]
}

export type SyllabusResult = { ok: true; doc: SyllabusDoc } | { ok: false; errors: string[] }

const slug = (value: string) =>
	value
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^a-z0-9/]+/g, '-')
		.replace(/^-+|-+$/g, '')

const qualify = (prefix: string, id: string) => (id.includes('/') ? id : `${prefix}/${id}`)

type Raw = Record<string, unknown>
const isMap = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const list = (v: unknown): string[] =>
	Array.isArray(v) ? v.map(text).filter(Boolean) : typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : []

export function parseSyllabus(source: string): SyllabusResult {
	let raw: unknown
	try {
		raw = parseYaml(source)
	} catch (error) {
		if (error instanceof YAMLParseError) {
			const line = error.linePos?.[0]?.line
			return { ok: false, errors: [`${line ? `Line ${line}: ` : ''}${error.message.split('\n')[0]}`] }
		}
		return { ok: false, errors: ['Not valid YAML'] }
	}
	if (!isMap(raw)) return { ok: false, errors: ['A syllabus is a map with goal, tracks and tree'] }
	const errors: string[] = []
	const goal = slug(text(raw.goal))
	if (!goal) errors.push('goal is required: a short id such as "adler" or "film"')
	const treeRaws = [...(isMap(raw.tree) ? [raw.tree] : []), ...(Array.isArray(raw.trees) ? raw.trees.filter(isMap) : [])]
	// Tags name nodes of the first tree unless they say otherwise.
	const treeId = slug(text(treeRaws[0]?.id)) || goal
	const tag = (t: string) => qualify(treeId, slug(t))

	const parseItem = (value: unknown, prefix: string, path: string): DocItem | null => {
		if (!isMap(value)) {
			errors.push(`${path}: an item is a map with at least id and title`)
			return null
		}
		const id = slug(text(value.id) || text(value.title))
		const title = text(value.title) || text(value.id)
		if (!id || !title) {
			errors.push(`${path}: an item needs an id or a title`)
			return null
		}
		const kindRaw = text(value.kind).toLowerCase()
		const kind = ITEM_KINDS.find((k) => k.toLowerCase() === kindRaw) ?? ''
		if (kindRaw && !kind) errors.push(`${path}: kind is one of ${ITEM_KINDS.join(', ')}`)
		const itemId = qualify(prefix, id)
		const ruleRaw = value.childRule
		const childRule =
			typeof ruleRaw === 'number' ? formatChildRule({ kind: 'n', n: ruleRaw }) : text(ruleRaw) === 'all' ? 'all' : /^n:\d+$/.test(text(ruleRaw)) ? text(ruleRaw) : 'core'
		const children = Array.isArray(value.children)
			? value.children.map((child, i) => parseItem(child, itemId, `${path} › child ${i + 1}`)).filter((c): c is DocItem => !!c)
			: []
		return {
			itemId,
			title,
			kind,
			medium: text(value.medium).toLowerCase(),
			tags: list(value.tags).map(tag),
			core: value.core === true,
			childRule,
			children,
		}
	}

	const tracks: DocTrack[] = []
	for (const [i, value] of (Array.isArray(raw.tracks) ? raw.tracks : []).entries()) {
		const path = `Track ${i + 1}`
		if (!isMap(value)) {
			errors.push(`${path}: a track is a map with id, name and items`)
			continue
		}
		const trackId = qualify(goal, slug(text(value.id) || text(value.name)))
		const items: DocItem[] = []
		const order: string[] = []
		for (const [j, entry] of (Array.isArray(value.items) ? value.items : []).entries()) {
			if (typeof entry === 'string') {
				order.push(qualify(goal, slug(entry)))
				continue
			}
			const item = parseItem(entry, goal, `${path} › item ${j + 1}`)
			if (item) {
				items.push(item)
				order.push(item.itemId)
			}
		}
		const state = text(value.state)
		tracks.push({
			trackId,
			name: text(value.name) || trackId,
			state: ['active', 'paused', 'notStarted'].includes(state) ? state : 'notStarted',
			defaultTags: list(value.defaultTags).map(tag),
			items,
			order,
		})
	}

	const trees: DocTree[] = []
	for (const [t, treeRaw] of treeRaws.entries()) {
		const treeId = slug(text(treeRaw.id)) || (t === 0 ? goal : '')
		if (!treeId) {
			errors.push(`Tree ${t + 1}: a tree after the first needs an id`)
			continue
		}
		const nodes: DocNode[] = []
		for (const [i, value] of (Array.isArray(treeRaw.nodes) ? treeRaw.nodes : []).entries()) {
			const path = treeRaws.length > 1 ? `Tree ${t + 1} › node ${i + 1}` : `Tree node ${i + 1}`
			if (!isMap(value) || !text(value.id)) {
				errors.push(`${path}: a node needs an id`)
				continue
			}
			const requires = qualifyRequirements(value.requires, treeId, goal, `${path}`, errors)
			nodes.push({
				nodeId: qualify(treeId, slug(text(value.id))),
				name: text(value.name) || text(value.id),
				kind: ['root', 'skill', 'method', 'keystone', 'pillar', 'mastery'].includes(text(value.kind)) ? text(value.kind) : 'skill',
				icon: text(value.icon),
				sector: text(value.sector),
				ring: text(value.ring),
				requires,
			})
		}
		const layout = text(treeRaw.layout)
		const mount = text(treeRaw.mount)
		trees.push({
			treeId,
			name: text(treeRaw.name) || (t === 0 ? text(raw.name) : '') || treeId,
			goal: text(raw.name) || goal,
			layout: ['sectors', 'lineage', 'free'].includes(layout) ? layout : 'sectors',
			sectors: list(treeRaw.sectors),
			rings: list(treeRaw.rings),
			mount: mount ? qualify(goal, slug(mount)) : '',
			nodes,
		})
	}

	if (errors.length) return { ok: false, errors }
	return { ok: true, doc: { goal, name: text(raw.name) || goal, tracks, trees } }
}

/** Requirements written as YAML, with node ids and every kind's own ids qualified, back to stored YAML. */
function qualifyRequirements(value: unknown, treeId: string, goal: string, path: string, errors: string[]): string {
	if (value === undefined || value === null || value === '') return ''
	const source = typeof value === 'string' ? value : stringifyYaml(value)
	const result = qualifyConditions(source, { goal: (id) => qualify(goal, slug(id)), tree: (id) => qualify(treeId, slug(id)) })
	if (!result.ok) {
		errors.push(`${path}: ${result.error}`)
		return ''
	}
	return stringifyYaml(result.conditions, { flowCollectionPadding: true }).trim()
}

/** Everything a document will create, counted, for a confirmation message. */
export function describeDoc(doc: SyllabusDoc): string {
	const count = (items: DocItem[]): number => items.reduce((n, item) => n + 1 + count(item.children), 0)
	const items = doc.tracks.reduce((n, t) => n + count(t.items), 0)
	const nodes = doc.trees.reduce((n, t) => n + t.nodes.length, 0)
	const parts = [
		`${doc.tracks.length} track${doc.tracks.length === 1 ? '' : 's'}`,
		`${items} item${items === 1 ? '' : 's'}`,
		nodes ? `${nodes} skill node${nodes === 1 ? '' : 's'}${doc.trees.length > 1 ? ` in ${doc.trees.length} trees` : ''}` : '',
	]
	return parts.filter(Boolean).join(', ')
}
