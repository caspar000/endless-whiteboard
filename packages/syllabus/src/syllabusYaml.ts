import { firstTreeId, isMap, list, parseTrees, qualify, slug, text, type DocTree } from '@lifeboard/skill-tree'
import { parse as parseYaml, YAMLParseError } from 'yaml'
import { formatChildRule, ITEM_KINDS } from './model'

export type { DocNode, DocTree } from '@lifeboard/skill-tree'

/**
 * The one format for import, export and the agent's drafts (docs/skill-tree-plan.md, "The YAML
 * format"). Pure: text in, a validated document with fully qualified ids out. The `tree:` or
 * `trees:` part is the skill tree's (its treeYaml.ts).
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

export interface SyllabusDoc {
	goal: string
	name: string
	tracks: DocTrack[]
	/** `tree:` (one) or `trees:` (several, each with its own id; a tree can `mount:` on another's node). */
	trees: DocTree[]
}

export type SyllabusResult = { ok: true; doc: SyllabusDoc } | { ok: false; errors: string[] }

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
	// Tags name nodes of the first tree unless they say otherwise.
	const treeId = firstTreeId(raw, goal)
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

	const trees = parseTrees(raw, goal, errors)

	if (errors.length) return { ok: false, errors }
	return { ok: true, doc: { goal, name: text(raw.name) || goal, tracks, trees } }
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
