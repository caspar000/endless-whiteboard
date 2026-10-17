import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { habitHistory, habitRuleValue, habitStart, type Period } from './habits'
import { todayIso } from './model'
import type { HabitIndex, IndexEntry, SkillIndex } from './skillIndex'

/**
 * What a skill node asks for, and whether the evidence gives it (docs/skill-tree-plan.md, "Trees and
 * skill nodes"). Pure: the index and the tree's nodes in, a status out.
 *
 * ```yaml
 * - node: [adler/root]               # these nodes are unlocked
 * - item: adler/011-aristotle        # this item is done, with evidence
 * - count: { min: 3, kind: Practice } # evidence tagged to this node, filtered
 * - habit: { id: film-week, rule: total, min: 4 }   # step 3
 * ```
 */
export type Condition =
	| { node: string[] }
	| { item: string }
	| { count: { min: number; kind?: string; medium?: string; method?: string } }
	| { habit: { id: string; rule: string; min: number } }

export type ParseResult = { ok: true; conditions: Condition[] } | { ok: false; error: string }

export function parseRequirements(source: string): ParseResult {
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

function parseCondition(entry: unknown): Condition | string {
	if (!entry || typeof entry !== 'object') return 'expected node, item, count or habit'
	const e = entry as Record<string, unknown>
	if ('node' in e) {
		const ids = Array.isArray(e.node) ? e.node : [e.node]
		if (!ids.every((id) => typeof id === 'string' && id)) return 'node takes node ids'
		return { node: ids as string[] }
	}
	if ('item' in e) return typeof e.item === 'string' && e.item ? { item: e.item } : 'item takes an item id'
	if ('count' in e) {
		const c = (e.count ?? {}) as Record<string, unknown>
		const min = Number(c.min)
		if (!Number.isFinite(min) || min < 1) return 'count needs min: 1 or more'
		const out: { min: number; kind?: string; medium?: string; method?: string } = { min }
		for (const key of ['kind', 'medium', 'method'] as const) {
			if (typeof c[key] === 'string' && c[key]) out[key] = c[key] as string
		}
		return { count: out }
	}
	if ('habit' in e) {
		const h = (e.habit ?? {}) as Record<string, unknown>
		if (typeof h.id !== 'string' || !h.id) return 'habit needs an id'
		return { habit: { id: h.id, rule: typeof h.rule === 'string' ? h.rule : 'total', min: Number(h.min) || 1 } }
	}
	return 'expected node, item, count or habit'
}

export function formatRequirements(conditions: readonly Condition[]): string {
	return conditions.length ? stringifyYaml(conditions, { flowCollectionPadding: true }).trim() : ''
}

export type NodeState = 'locked' | 'available' | 'unlocked'

export interface ConditionStatus {
	label: string
	have: number
	need: number
	met: boolean
}

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
	/** Items tagged to this node, done with evidence. */
	evidence: IndexEntry[]
	mastery: Mastery
}

export interface TreeNode {
	nodeId: string
	name: string
	requires: string
	/** `method` nodes count evidence from the whole tree, by how it was made (see below). */
	kind?: string
}

/**
 * Evaluates every node of a tree against the index. Prerequisites are followed by id; a node that
 * names one the tree doesn't have, or that sits in a cycle, stays locked.
 */
export function evaluateTree(
	nodes: readonly TreeNode[],
	index: SkillIndex,
	habits: HabitIndex = {},
	today: string = todayIso()
): Map<string, NodeStatus> {
	const byId = new Map(nodes.map((n) => [n.nodeId, n]))
	const evidenceByTag = new Map<string, IndexEntry[]>()
	for (const entry of Object.values(index)) {
		if (!entry.evidence) continue
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
	const treeEvidence = new Map<string, IndexEntry>()
	for (const node of nodes) for (const e of evidenceByTag.get(node.nodeId) ?? []) treeEvidence.set(e.itemId, e)
	const out = new Map<string, NodeStatus>()
	const visiting = new Set<string>()

	const evaluate = (nodeId: string): NodeStatus => {
		const done = out.get(nodeId)
		if (done) return done
		const node = byId.get(nodeId)
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
			if ('node' in condition) {
				const have = condition.node.filter((id) => evaluate(id).state === 'unlocked').length
				const met = have === condition.node.length
				if (!met) prerequisitesMet = false
				statuses.push({ label: `Unlock ${condition.node.map((id) => byId.get(id)?.name ?? id).join(', ')}`, have, need: condition.node.length, met })
			} else if ('item' in condition) {
				const entry = index[condition.item]
				const met = !!entry?.evidence
				statuses.push({ label: entry?.title ?? condition.item, have: met ? 1 : 0, need: 1, met })
			} else if ('count' in condition) {
				const { min, kind, medium, method } = condition.count
				const matching = evidence.filter(
					(e) =>
						(!kind || e.kind.toLowerCase() === kind.toLowerCase()) &&
						(!medium || e.medium.toLowerCase() === medium.toLowerCase()) &&
						(!method || e.method.toLowerCase() === method.toLowerCase())
				)
				consumed = Math.max(consumed, min)
				const filter = [kind, medium, method].filter(Boolean).join(', ')
				statuses.push({ label: `${min} ${min === 1 ? 'piece' : 'pieces'}${filter ? ` (${filter})` : ''}`, have: Math.min(matching.length, min), need: min, met: matching.length >= min })
			} else {
				const { id, rule, min } = condition.habit
				const habit = habits[id]
				const start = habit ? habitStart(habit, index) : null
				const period = (habit?.period ?? 'week') as Period
				const value =
					habit && start
						? habitRuleValue(habitHistory({ ...habit, period, startedAt: start }, Object.values(index), today), rule, period)
						: 0
				const ruleLabel: Record<string, string> = { total: 'in total', streak: `${period}s in a row`, best_week: 'in one week', days: `${period}s on target`, periods: `${period}s on target` }
				statuses.push({ label: `${habit?.name || id}: ${min} ${ruleLabel[rule] ?? rule}`, have: Math.min(value, min), need: min, met: value >= min })
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

function lockedStatus(evidence: IndexEntry[]): NodeStatus {
	return { state: 'locked', conditions: [], evidence, mastery: masteryOf([]) }
}

/**
 * Bronze, Silver and Gold at 3, 10 and 25 pieces of evidence beyond unlocking, each tier needing one
 * more Ship than the last: mastery means having made things, not only taken them in.
 */
export function masteryOf(beyond: readonly IndexEntry[]): Mastery {
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
