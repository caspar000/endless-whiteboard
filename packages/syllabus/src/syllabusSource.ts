import { computed } from '@lifeboard/canvas'
import type { Evidence, RequirementKind, TreeSource } from '@lifeboard/skill-tree'
import { mediumIcon } from './mediumIcon'
import { getItems, getSkillIndex, isItemDone, progressOf } from './syllabus'
import { syllabusMakers } from './syllabusTrees'

/**
 * The syllabus as a source for skill trees (sources.ts): its write-ups are evidence, its entries and
 * works are what a view draws beside the nodes they are tagged to, nodes can ask for an item written
 * up (`item:`), done (`done:`) or a number of write-ups (`count:`), and every syllabus is something a
 * tree can be made from (syllabusTrees.ts).
 */

/** Items done with a write-up, as evidence for the nodes they are tagged to. */
const evidence = computed<Evidence[]>('lifeboard:syllabus-evidence-for-trees', () =>
	Object.values(getSkillIndex())
		.filter((e) => e.evidence)
		.map(({ itemId, title, doneAt, kind, medium, method, tags }) => ({ id: itemId, title, doneAt, kind, medium, method, tags }))
)

const item: RequirementKind = {
	key: 'item',
	parse: (value) => (typeof value === 'string' && value ? { ok: true, value } : { ok: false, error: 'item takes an item id' }),
	qualify: (value, ids) => ids.goal(value as string),
	evaluate: (value) => {
		const entry = getSkillIndex()[value as string]
		const met = !!entry?.evidence
		return { label: entry?.title ?? (value as string), have: met ? 1 : 0, need: 1, met }
	},
}

/**
 * An item done: a work ticked, or an entry whose works are done by its rule. Unlike `item:`, no
 * write-up is asked for; a path made from a syllabus lights its nodes this way.
 */
const done: RequirementKind = {
	key: 'done',
	parse: (value) => (typeof value === 'string' && value ? { ok: true, value } : { ok: false, error: 'done takes an item id' }),
	qualify: (value, ids) => ids.goal(value as string),
	evaluate: (value) => {
		const item = getItems()[value as string]
		const met = !!item && isItemDone(item.itemId)
		return { label: item ? `Finish ${item.title}` : (value as string), have: met ? 1 : 0, need: 1, met }
	},
}

type Count = { min: number; kind?: string; medium?: string; method?: string }

const count: RequirementKind = {
	key: 'count',
	parse: (value) => {
		const c = (value ?? {}) as Record<string, unknown>
		const min = Number(c.min)
		if (!Number.isFinite(min) || min < 1) return { ok: false, error: 'count needs min: 1 or more' }
		const out: Count = { min }
		for (const key of ['kind', 'medium', 'method'] as const) {
			if (typeof c[key] === 'string' && c[key]) out[key] = c[key] as string
		}
		return { ok: true, value: out }
	},
	evaluate: (value, node) => {
		const { min, kind, medium, method } = value as Count
		const matching = node.evidence.filter(
			(e) =>
				(!kind || e.kind.toLowerCase() === kind.toLowerCase()) &&
				(!medium || e.medium.toLowerCase() === medium.toLowerCase()) &&
				(!method || e.method.toLowerCase() === method.toLowerCase())
		)
		const filter = [kind, medium, method].filter(Boolean).join(', ')
		return {
			label: `${min} ${min === 1 ? 'piece' : 'pieces'}${filter ? ` (${filter})` : ''}`,
			have: Math.min(matching.length, min),
			need: min,
			met: matching.length >= min,
			consumed: min,
		}
	},
}

export const syllabusTreeSource: TreeSource = {
	id: 'lifeboard.syllabus',
	requirements: [item, done, count],
	makers: syllabusMakers,
	evidence: () => evidence.get(),
	items: getItems,
	look: (itemId) => {
		const entry = getItems()[itemId]
		if (!entry) return null
		const done = isItemDone(itemId)
		return {
			title: entry.title,
			icon: mediumIcon(entry),
			done,
			// Done but no write-up yet: done, not yet evidence.
			hollow: done && !entry.children.length && !getSkillIndex()[itemId]?.evidence,
			draft: !!entry.draft,
			progress: entry.children.length ? progressOf(itemId) : null,
		}
	},
}
