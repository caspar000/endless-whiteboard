/**
 * The syllabus model with no editor in it: child rules, progress, what counts as evidence, and which
 * item in a track comes next (docs/skill-tree-plan.md).
 *
 * Kept free of tldraw so every rule here is a plain unit test. The shapes and the ops call into this;
 * nothing in here reads a board.
 */

/** Study a work, practise an exercise, ship a made thing. */
export const ITEM_KINDS = ['Study', 'Practice', 'Ship'] as const
export type ItemKind = (typeof ITEM_KINDS)[number]

/**
 * When a parent counts as done.
 *
 * - `core`: every child marked core is done. With no core children it falls back to `all`, because a
 *   parent nobody marked anything core on should not be done the moment it exists.
 * - `all`: every child is done.
 * - `n`: at least `n` children are done.
 */
export type ChildRule = { kind: 'core' } | { kind: 'all' } | { kind: 'n'; n: number }

/** Stored as a string prop (`core`, `all`, `n:3`) because props stay JSON scalars. */
export function parseChildRule(raw: string): ChildRule {
	if (raw === 'all') return { kind: 'all' }
	const match = /^n:(\d+)$/.exec(raw)
	if (match) return { kind: 'n', n: Math.max(1, Number(match[1])) }
	return { kind: 'core' }
}

export function formatChildRule(rule: ChildRule): string {
	return rule.kind === 'n' ? `n:${rule.n}` : rule.kind
}

export interface ChildState {
	done: boolean
	core: boolean
}

export interface ChildProgress {
	done: number
	total: number
	coreDone: number
	coreTotal: number
	/** Whether the parent counts as done under its rule. Never true for a parent with no children. */
	complete: boolean
}

export function childProgress(children: readonly ChildState[], rule: ChildRule): ChildProgress {
	const total = children.length
	const done = children.filter((c) => c.done).length
	const core = children.filter((c) => c.core)
	const coreDone = core.filter((c) => c.done).length
	let complete = false
	if (total > 0) {
		if (rule.kind === 'all' || (rule.kind === 'core' && core.length === 0)) complete = done === total
		else if (rule.kind === 'core') complete = coreDone === core.length
		else complete = done >= Math.min(rule.n, total)
	}
	return { done, total, coreDone, coreTotal: core.length, complete }
}

/** "3/10 · core 1/2", or "3/10" when nothing is core. */
export function formatProgress(progress: ChildProgress): string {
	const base = `${progress.done}/${progress.total}`
	return progress.coreTotal > 0 ? `${base} · core ${progress.coreDone}/${progress.coreTotal}` : base
}

/**
 * Whether a note holds anything the template didn't already.
 *
 * A note counts as evidence once you have written in it. Every line that is also a line of the
 * template (its headings and prompts) is ignored, as are blank lines, bare list markers and the
 * top-level `# Title` the note is filed under, so ticking an item and walking away leaves a note that
 * is still "empty".
 */
export function hasEvidence(md: string, template: string): boolean {
	const templateLines = new Set(
		template
			.split('\n')
			.map((line) => normaliseLine(line))
			.filter(Boolean)
	)
	return md.split('\n').some((line) => {
		const normalised = normaliseLine(line)
		return normalised !== '' && !templateLines.has(normalised)
	})
}

function normaliseLine(line: string): string {
	const trimmed = line.trim()
	// A list marker or an empty task box with nothing after it is template scaffolding, not writing.
	if (/^([-*+]|\d+\.)(\s+\[[ xX]?\])?$/.test(trimmed)) return ''
	// The note's title names the item it is filed under; it says nothing about the work.
	if (/^#\s/.test(trimmed)) return ''
	return trimmed.replace(/\s+/g, ' ')
}

/** Encodes and decodes a track's order. Ids never contain a newline (see `makeItemId`). */
export function parseOrder(raw: string): string[] {
	return raw
		.split('\n')
		.map((id) => id.trim())
		.filter(Boolean)
}

export function formatOrder(ids: readonly string[]): string {
	return [...new Set(ids)].join('\n')
}

/** Tags are node ids, stored comma-separated. */
export function parseTags(raw: string): string[] {
	return raw
		.split(',')
		.map((tag) => tag.trim())
		.filter(Boolean)
}

export function formatTags(tags: readonly string[]): string {
	return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].join(', ')
}

/** The first id in order that isn't done. Ids the board doesn't know are skipped, not treated as next. */
export function nextInOrder(order: readonly string[], isDone: (id: string) => boolean | undefined): string | null {
	for (const id of order) {
		const done = isDone(id)
		if (done === false) return id
	}
	return null
}

/**
 * A stable global id from a title: a readable slug plus a short random suffix, so two items called
 * "Tragedies" never collide. The id outlives renames; it is only derived from the title once.
 */
export function makeItemId(title: string, prefix = '', random: () => number = Math.random): string {
	const slug =
		title
			.toLowerCase()
			.normalize('NFKD')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 40) || 'item'
	const suffix = Math.floor(random() * 36 ** 4)
		.toString(36)
		.padStart(4, '0')
	return `${prefix}${slug}-${suffix}`
}

/** Today in local time, as a `date` property stores it. */
export function todayIso(now: Date = new Date()): string {
	const month = String(now.getMonth() + 1).padStart(2, '0')
	const day = String(now.getDate()).padStart(2, '0')
	return `${now.getFullYear()}-${month}-${day}`
}
