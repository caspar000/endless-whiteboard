import { atom } from '@lifeboard/canvas'
import type { LucideIcon } from 'lucide-react'

/**
 * What other extensions give a skill tree (docs/skill-tree-plan.md, "The split"). A tree on its own
 * knows its nodes, their prerequisites and hand ticks. A source adds the rest: kinds of requirement a
 * node can name, evidence that counts toward a node, and items a view draws beside the nodes they are
 * tagged to. The syllabus is one source; the tree never imports it.
 *
 * Reads go through `getTreeSources()`, an atom, so anything reading a source inside a `useValue` or
 * `react` also follows the source's own atoms.
 */

/** A piece of finished work that counts toward the nodes it is tagged to. */
export interface Evidence {
	id: string
	title: string
	/** `YYYY-MM-DD`. */
	doneAt: string
	kind: string
	medium: string
	method: string
	/** The node ids it counts toward. */
	tags: readonly string[]
}

/** Something a tree view draws beside the skill nodes it is tagged to: an entry, and its works below it. */
export interface TreeItem {
	itemId: string
	/** The item it hangs from in the view, or '' for one that hangs from a skill node. */
	parent: string
	children: readonly string[]
	tags: readonly string[]
}

/** How an item is drawn. */
export interface TreeItemLook {
	title: string
	icon: LucideIcon
	done: boolean
	/** Done, but not yet evidence: drawn as an outline. */
	hollow: boolean
	draft: boolean
	/** Works done of all, for an item with works. */
	progress: { done: number; total: number } | null
}

export interface ConditionStatus {
	label: string
	have: number
	need: number
	met: boolean
}

/** What a node's evaluation hands a requirement. */
export interface RequirementContext {
	nodeId: string
	/** Evidence for this node, oldest first. */
	evidence: readonly Evidence[]
	/** When the node was ticked by hand, `YYYY-MM-DD`, or ''. */
	tickedAt: string
}

/**
 * A kind of condition in a node's `requires:` list, by the key it is written under
 * (`- item: adler/homer`).
 */
export interface RequirementKind {
	key: string
	/** Checks what follows the key, and returns it in the form `evaluate` takes, or an error. */
	parse(value: unknown): { ok: true; value: unknown } | { ok: false; error: string }
	/** For YAML written with short ids: the value with them made full. */
	qualify?(value: unknown, ids: { goal: (id: string) => string; tree: (id: string) => string }): unknown
	/** `consumed`: how much of the node's evidence meeting it used up, so mastery counts only the rest. */
	evaluate(value: unknown, node: RequirementContext): ConditionStatus & { consumed?: number }
}

export interface TreeSource {
	id: string
	requirements?: readonly RequirementKind[]
	/** Every piece of evidence the source has. */
	evidence?(): readonly Evidence[]
	/** Every item the source can put in a tree view, by id. */
	items?(): Readonly<Record<string, TreeItem>>
	/** How one of its items looks, or null if it isn't one of the source's. */
	look?(itemId: string): TreeItemLook | null
}

const sources = atom<readonly TreeSource[]>('lifeboard:tree-sources', [])

/** Adds a source, or replaces the one with its id. */
export function registerTreeSource(source: TreeSource): void {
	sources.set([...sources.get().filter((s) => s.id !== source.id), source])
}

export const getTreeSources = (): readonly TreeSource[] => sources.get()

/** Every source's evidence, together. */
export function allEvidence(): Evidence[] {
	return getTreeSources().flatMap((s) => s.evidence?.() ?? [])
}

/** Every source's items, together. */
export function allItems(): Readonly<Record<string, TreeItem>> {
	const out: Record<string, TreeItem> = {}
	for (const source of getTreeSources()) Object.assign(out, source.items?.())
	return out
}

export function getTreeItem(itemId: string): TreeItem | undefined {
	for (const source of getTreeSources()) {
		const item = source.items?.()[itemId]
		if (item) return item
	}
	return undefined
}

export function lookOf(itemId: string): TreeItemLook | null {
	for (const source of getTreeSources()) {
		const look = source.look?.(itemId)
		if (look) return look
	}
	return null
}

export function requirementKind(key: string): RequirementKind | undefined {
	for (const source of getTreeSources()) {
		const kind = source.requirements?.find((k) => k.key === key)
		if (kind) return kind
	}
	return undefined
}
