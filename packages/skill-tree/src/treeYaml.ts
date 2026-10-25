import { stringify as stringifyYaml } from 'yaml'
import { qualifyConditions } from './requirements'

/**
 * Trees written as YAML (docs/skill-tree-plan.md, "The YAML format"): the `tree:` or `trees:` part of
 * a document, whichever extension's document it is. Pure.
 *
 * Ids are written short and qualified on the way in: a node `greek-drama` in tree `adler` is
 * `adler/greek-drama`. An id that already has a `/` is taken as it is, which is how a node names a
 * prerequisite in another tree.
 */

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

export const slug = (value: string) =>
	value
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^a-z0-9/]+/g, '-')
		.replace(/^-+|-+$/g, '')

export const qualify = (prefix: string, id: string) => (id.includes('/') ? id : `${prefix}/${id}`)

type Raw = Record<string, unknown>
export const isMap = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v)
export const text = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
export const list = (v: unknown): string[] =>
	Array.isArray(v) ? v.map(text).filter(Boolean) : typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : []

/** A document's trees, raw: `tree:` (one) and `trees:` (several). */
export const treeRawsOf = (raw: Raw): Raw[] => [...(isMap(raw.tree) ? [raw.tree] : []), ...(Array.isArray(raw.trees) ? raw.trees.filter(isMap) : [])]

/** The id of a document's first tree: what its other parts' short node ids mean. */
export const firstTreeId = (raw: Raw, goal: string): string => slug(text(treeRawsOf(raw)[0]?.id)) || goal

/** A document's trees, with every id qualified. Problems go to `errors`, each with its place. */
export function parseTrees(raw: Raw, goal: string, errors: string[]): DocTree[] {
	const treeRaws = treeRawsOf(raw)
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
	return trees
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
