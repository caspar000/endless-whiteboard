import { parse as parseYaml } from 'yaml'
import type { IndexEntry } from './skillIndex'

/**
 * Habits: a target per day, week or month, counted by hand or from completions
 * (docs/skill-tree-plan.md, "Habits"). Pure, like requirements.ts: dates and entries in, history out.
 *
 * Weeks run Monday to Sunday. A period ends hit or missed, and a miss costs nothing: there is no
 * decay and nothing red. The rules a skill node can ask of a habit are Life RPG's four
 * (`backend/app/services/paths.py`), read over periods rather than only days.
 */
export type Period = 'day' | 'week' | 'month'

export const PERIODS: readonly Period[] = ['day', 'week', 'month']

export const PERIOD_NOUN: Record<Period, string> = { day: 'day', week: 'week', month: 'month' }

/** What an automatic habit counts. Empty means counted by hand. */
export interface HabitFilter {
	kind?: string
	medium?: string
	method?: string
	tag?: string
}

export interface HabitSpec {
	habitId: string
	period: Period
	target: number
	/** YAML map (`kind: Ship`), or '' for a habit ticked by hand. */
	counts: string
	/** `YYYY-MM-DD`: no period before this one counts, hit or missed. */
	startedAt: string
	/** Hand ticks by period key, `{ "2026-W42": 1 }`, stored as JSON. */
	log: string
}

/** Parses the filter. Anything unreadable counts as "by hand", so a typo never invents progress. */
export function parseFilter(counts: string): HabitFilter | null {
	if (!counts.trim()) return null
	try {
		const raw = parseYaml(counts) as unknown
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
		const out: HabitFilter = {}
		for (const key of ['kind', 'medium', 'method', 'tag'] as const) {
			const value = (raw as Record<string, unknown>)[key]
			if (typeof value === 'string' && value) out[key] = value
		}
		return Object.keys(out).length ? out : null
	} catch {
		return null
	}
}

export function parseLog(log: string): Record<string, number> {
	try {
		const raw = JSON.parse(log || '{}') as unknown
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
		const out: Record<string, number> = {}
		for (const [key, value] of Object.entries(raw)) if (typeof value === 'number' && value > 0) out[key] = value
		return out
	} catch {
		return {}
	}
}

function parseDay(iso: string): Date {
	const [y, m, d] = iso.split('-').map(Number)
	return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}

function iso(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** The Monday of the week a day falls in. */
function monday(date: Date): Date {
	const out = new Date(date)
	out.setDate(date.getDate() - ((date.getDay() + 6) % 7))
	return out
}

/** The key of the period a day falls in: `2026-10-17`, `2026-10-12` (that week's Monday), `2026-10`. */
export function periodKey(day: string, period: Period): string {
	if (period === 'day') return day.slice(0, 10)
	if (period === 'month') return day.slice(0, 7)
	return iso(monday(parseDay(day)))
}

/** Period keys from the one `from` falls in to the one `to` falls in, oldest first. */
export function periodsBetween(from: string, to: string, period: Period): string[] {
	const out: string[] = []
	if (!from || from > to) return [periodKey(to, period)]
	let cursor = parseDay(from)
	if (period === 'week') cursor = monday(cursor)
	if (period === 'month') cursor = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
	const end = periodKey(to, period)
	for (let guard = 0; guard < 20000; guard++) {
		const key = periodKey(iso(cursor), period)
		out.push(key)
		if (key >= end) break
		if (period === 'day') cursor.setDate(cursor.getDate() + 1)
		else if (period === 'week') cursor.setDate(cursor.getDate() + 7)
		else cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
	}
	return out
}

export interface PeriodResult {
	key: string
	count: number
	met: boolean
}

function matches(entry: IndexEntry, filter: HabitFilter): boolean {
	const eq = (a: string, b?: string) => !b || a.toLowerCase() === b.toLowerCase()
	return (
		entry.evidence &&
		eq(entry.kind, filter.kind) &&
		eq(entry.medium, filter.medium) &&
		eq(entry.method, filter.method) &&
		(!filter.tag || entry.tags.includes(filter.tag))
	)
}

/**
 * Every period from the habit's start to today, with its count and whether it met the target. An
 * automatic habit counts written-up completions done in the period that match its filter; a hand
 * tick adds to either kind.
 */
export function habitHistory(spec: HabitSpec, entries: readonly IndexEntry[], today: string): PeriodResult[] {
	const filter = parseFilter(spec.counts)
	const manual = parseLog(spec.log)
	const auto = new Map<string, number>()
	if (filter) {
		for (const entry of entries) {
			if (!entry.doneAt || !matches(entry, filter)) continue
			const key = periodKey(entry.doneAt, spec.period)
			auto.set(key, (auto.get(key) ?? 0) + 1)
		}
	}
	const target = Math.max(1, spec.target)
	return periodsBetween(spec.startedAt || today, today, spec.period).map((key) => {
		const count = (auto.get(key) ?? 0) + (manual[key] ?? 0)
		return { key, count, met: count >= target }
	})
}

/** Life RPG's rules: `total` of counts, `streak` of periods met in a row, `best_week`, and `days` met. */
export function habitRuleValue(history: readonly PeriodResult[], rule: string, period: Period): number {
	if (rule === 'streak') {
		let best = 0
		let run = 0
		for (const p of history) {
			run = p.met ? run + 1 : 0
			best = Math.max(best, run)
		}
		return best
	}
	if (rule === 'days' || rule === 'periods') return history.filter((p) => p.met).length
	if (rule === 'best_week') {
		if (period !== 'day') return Math.max(0, ...history.map((p) => p.count))
		const weeks = new Map<string, number>()
		for (const p of history) {
			const week = periodKey(p.key, 'week')
			weeks.set(week, (weeks.get(week) ?? 0) + p.count)
		}
		return Math.max(0, ...weeks.values())
	}
	return history.reduce((sum, p) => sum + p.count, 0)
}

/**
 * The day a habit's periods start counting, or `null` while it waits for the item that starts it.
 * Started by an item, it begins the day that item was done, never before the habit was made.
 */
export function habitStart(
	habit: { startedAt: string; startedBy: string },
	items: Readonly<Record<string, IndexEntry>>
): string | null {
	if (!habit.startedBy) return habit.startedAt || null
	const item = items[habit.startedBy]
	if (!item?.done || !item.doneAt) return null
	return item.doneAt > habit.startedAt ? item.doneAt : habit.startedAt || item.doneAt
}

/** The current run of periods met, ending with the last completed one (the current period counts once met). */
export function currentStreak(history: readonly PeriodResult[]): number {
	let run = 0
	for (let i = history.length - 1; i >= 0; i--) {
		const p = history[i]!
		if (p.met) run++
		else if (i === history.length - 1) continue
		else break
	}
	return run
}
