import { parse as parseYaml } from 'yaml'
import { getTreeSources, requirementKind, type ConditionStatus, type Evidence } from './sources'

export type { ConditionStatus } from './sources'

/**
 * What a skill node asks for, and whether it has it (docs/skill-tree-plan.md, "Trees and skill
 * nodes"). Pure: the tree's nodes and the evidence in, a status out.
 *
 * ```yaml
 * - node: [adler/root]   # these nodes are unlocked
 * - manual: Read it      # ticked by hand (right-click › Mark as done)
 * - item: adler/homer    # any other key is a kind a source registers (sources.ts)
 * ```
 */
export interface Condition {
	key: string
	/** `node`'s is the list of node ids; any other kind's is what its `parse` returned. */
	value: unknown
}

export type ParseResult = { ok: true; conditions: Condition[] } | { ok: false; error: string }

/** The kinds every tree has, without a source. */
const BUILT_IN = ['node', 'manual']

/**
 * Parsed requirements by their text. Every node on a board evaluates its whole tree whenever the
 * index or the vault changes, so the same few hundred strings were parsed by YAML again and again
 * (a million times over for a confirmed /mu/core). Results are shared: treat them as read-only.
 * What parses depends on the registered sources, so a new source empties the cache.
 */
const parsedCache = new Map<string, ParseResult>()
let cachedFor: unknown = null

export function parseRequirements(source: string): ParseResult {
	if (cachedFor !== getTreeSources()) {
		parsedCache.clear()
		cachedFor = getTreeSources()
	}
	const known = parsedCache.get(source)
	if (known) return known
	const result = parseUncached(source)
	// Bounded, in case something feeds it endless distinct text (a requirement being typed).
	if (parsedCache.size > 5000) parsedCache.clear()
	parsedCache.set(source, result)
	return result
}

function parseUncached(source: string): ParseResult {
	if (!source.trim()) return { ok: true, conditions: [] }
	let raw: unknown
	try {
		raw = parseYaml(source)
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message.split('\n')[0]! : 'Not valid YAML' }
	}
	if (raw === null || raw === undefined) return { ok: true, conditions: [] }
	if (!Array.isArray(raw)) return { ok: false, error: 'Requirements are a list: each line starts with "- "' }
	const conditions: Condition[] = []
	for (const [i, entry] of raw.entries()) {
		const parsed = parseCondition(entry)
		if (typeof parsed === 'string') return { ok: false, error: `Item ${i + 1}: ${parsed}` }
		conditions.push(parsed)
	}
	return { ok: true, conditions }
}

/** The keys a condition may be written under, for error messages. */
const knownKeys = () => [...BUILT_IN, ...getTreeSources().flatMap((s) => s.requirements?.map((k) => k.key) ?? [])].join(', ')

function parseCondition(entry: unknown): Condition | string {
	if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return `expected one of ${knownKeys()}`
	const [key, value] = Object.entries(entry as Record<string, unknown>)[0] ?? []
	if (!key) return `expected one of ${knownKeys()}`
	if (key === 'node') {
		const ids = Array.isArray(value) ? value : [value]
		if (!ids.every((id) => typeof id === 'string' && id)) return 'node takes node ids'
		return { key, value: ids as string[] }
	}
	if (key === 'manual') return { key, value: typeof value === 'string' ? value : '' }
	const kind = requirementKind(key)
	if (!kind) return `unknown requirement "${key}": expected one of ${knownKeys()}`
	const parsed = kind.parse(value)
	return parsed.ok ? { key, value: parsed.value } : parsed.error
}

/** The node ids a `node` condition names; none for any other. */
export const nodesOf = (c: Condition): string[] => (c.key === 'node' ? (c.value as string[]) : [])

/** Whether a node's requirements ask for a hand tick. */
export function asksForTick(requires: string): boolean {
	const parsed = parseRequirements(requires)
	return parsed.ok && parsed.conditions.some((c) => c.key === 'manual')
}

/**
 * Requirements written in YAML with short ids, made full: node ids get the tree's prefix, and each
 * source's kind qualifies its own. Returns the conditions as YAML-ready values, or an error.
 */
export function qualifyConditions(
	source: string,
	ids: { goal: (id: string) => string; tree: (id: string) => string }
): { ok: true; conditions: Record<string, unknown>[] } | { ok: false; error: string } {
	const parsed = parseRequirements(source)
	if (!parsed.ok) return parsed
	return {
		ok: true,
		conditions: parsed.conditions.map((c) => {
			if (c.key === 'node') return { node: nodesOf(c).map(ids.tree) }
			const kind = requirementKind(c.key)
			return { [c.key]: kind?.qualify ? kind.qualify(c.value, ids) : c.value }
		}),
	}
}

export type NodeState = 'locked' | 'available' | 'unlocked'

export const TIERS = ['Bronze', 'Silver', 'Gold'] as const
export const TIER_AT = [3, 10, 25] as const

export interface Mastery {
	/** Evidence beyond what unlocking used. Endless: it keeps counting after Gold. */
	count: number
	/** 0 none, 1 Bronze, 2 Silver, 3 Gold. */
	tier: number
	/** Evidence needed for the next tier, or null after Gold. */
	nextAt: number | null
	/** Ship items among the mastery evidence; tier n needs n of them. */
	ships: number
}

export interface NodeStatus {
	state: NodeState
	conditions: ConditionStatus[]
	/** Evidence tagged to this node. */
	evidence: Evidence[]
	mastery: Mastery
}

export interface TreeNode {
	nodeId: string
	name: string
	requires: string
	/** `method` nodes count evidence from the whole tree, by how it was made (see below). */
	kind?: string
	/** When it was ticked by hand, `YYYY-MM-DD`, or ''. */
	tickedAt?: string
}

/**
 * Evaluates every node of a tree against the evidence. Prerequisites are followed by id; a node that
 * names one the tree doesn't have, or that sits in a cycle, stays locked.
 */
export function evaluateTree(
	nodes: readonly TreeNode[],
	evidenceIn: readonly Evidence[],
	/** The state of a node of another tree, for a node here that requires it. */
	outside?: (nodeId: string) => NodeStatus | undefined
): Map<string, NodeStatus> {
	const byId = new Map(nodes.map((n) => [n.nodeId, n]))
	const evidenceByTag = new Map<string, Evidence[]>()
	for (const entry of evidenceIn) {
		for (const tag of entry.tags) {
			const list = evidenceByTag.get(tag)
			if (list) list.push(entry)
			else evidenceByTag.set(tag, [entry])
		}
	}
	/*
	 * A method node is about *how* you studied, not what: "three books read analytically" is met by
	 * any three, whatever field they were tagged to. So its pool is every piece of evidence tagged to
	 * any node of this tree, and its count conditions are expected to filter by method.
	 */
	const treeEvidence = new Map<string, Evidence>()
	for (const node of nodes) for (const e of evidenceByTag.get(node.nodeId) ?? []) treeEvidence.set(e.id, e)
	const out = new Map<string, NodeStatus>()
	const visiting = new Set<string>()

	const evaluate = (nodeId: string): NodeStatus => {
		const done = out.get(nodeId)
		if (done) return done
		const node = byId.get(nodeId)
		if (!node && outside) {
			const there = outside(nodeId)
			if (there) return there
		}
		const pool = byId.get(nodeId)?.kind === 'method' ? [...treeEvidence.values()] : (evidenceByTag.get(nodeId) ?? [])
		const evidence = [...pool].sort((a, b) => a.doneAt.localeCompare(b.doneAt))
		if (!node || visiting.has(nodeId)) return lockedStatus(evidence)
		visiting.add(nodeId)
		const parsed = parseRequirements(node.requires)
		const conditions = parsed.ok ? parsed.conditions : []
		const statuses: ConditionStatus[] = []
		let prerequisitesMet = true
		let consumed = 0
		for (const condition of conditions) {
			if (condition.key === 'node') {
				const ids = nodesOf(condition)
				const have = ids.filter((id) => evaluate(id).state === 'unlocked').length
				const met = have === ids.length
				if (!met) prerequisitesMet = false
				statuses.push({ label: `Unlock ${ids.map((id) => byId.get(id)?.name ?? id).join(', ')}`, have, need: ids.length, met })
			} else if (condition.key === 'manual') {
				const met = !!node.tickedAt
				statuses.push({ label: (condition.value as string) || 'Ticked by hand', have: met ? 1 : 0, need: 1, met })
			} else {
				const kind = requirementKind(condition.key)
				if (!kind) {
					statuses.push({ label: `Nothing reads "${condition.key}"`, have: 0, need: 1, met: false })
					continue
				}
				const { consumed: used, ...status } = kind.evaluate(condition.value, { nodeId, evidence, tickedAt: node.tickedAt ?? '' })
				consumed = Math.max(consumed, used ?? 0)
				statuses.push(status)
			}
		}
		if (!parsed.ok) statuses.push({ label: `Requirements don't parse: ${parsed.error}`, have: 0, need: 1, met: false })
		visiting.delete(nodeId)
		const allMet = statuses.every((s) => s.met)
		const state: NodeState = !prerequisitesMet ? 'locked' : allMet ? 'unlocked' : 'available'
		const status: NodeStatus = {
			state,
			conditions: statuses,
			evidence,
			mastery: state === 'unlocked' ? masteryOf(evidence.slice(consumed)) : masteryOf([]),
		}
		out.set(nodeId, status)
		return status
	}

	for (const node of nodes) evaluate(node.nodeId)
	return out
}

function lockedStatus(evidence: Evidence[]): NodeStatus {
	return { state: 'locked', conditions: [], evidence, mastery: masteryOf([]) }
}

/**
 * Bronze, Silver and Gold at 3, 10 and 25 pieces of evidence beyond unlocking, each tier needing one
 * more Ship than the last: mastery means having made things, not only taken them in.
 */
export function masteryOf(beyond: readonly Evidence[]): Mastery {
	const count = beyond.length
	const ships = beyond.filter((e) => e.kind.toLowerCase() === 'ship').length
	let tier = 0
	for (let t = 0; t < TIER_AT.length; t++) {
		if (count >= TIER_AT[t]! && ships >= t + 1) tier = t + 1
	}
	const nextAt = tier < TIER_AT.length ? TIER_AT[tier]! : null
	return { count, tier, nextAt, ships }
}

/** Fraction of a node's conditions met, for its ring while it is still available. */
export function conditionFraction(status: NodeStatus): number {
	const need = status.conditions.reduce((sum, c) => sum + c.need, 0)
	if (!need) return status.state === 'unlocked' ? 1 : 0
	return status.conditions.reduce((sum, c) => sum + Math.min(c.have, c.need), 0) / need
}
