import type { ItemStamp, SourceEntry } from '@lifeboard/node-kit'

/**
 * A ranking (DARK-11): the items of one source, sorted into tiers you name, such as "Heavy rotation",
 * "Often", "Now and then" and "Rarely" for albums, or S to F for anything. Every rule about it that is
 * not drawing lives here, pure, so it is tested without a DOM.
 *
 * What it ranks is a source key from the kit's registry (`feeds:all`, `stamped:liked`, a backlog), so
 * the card knows nothing of where its items come from. Each source keeps its own arrangement: point
 * the card at another and back, and the first is as you left it.
 *
 * Weighted shuffle is a choice per ranking, off unless turned on. Then each tier carries a weight, the
 * card shows each tier's odds, and the ranking is offered to randomizers, which draw its items by their
 * tier's weight. Off, it is a ranking and nothing more.
 *
 * DARK-14: a ranking belongs to the board it was made on. What you stamp waits in its queue until you
 * drag it into a tier, and the stamp filters choose only what the queue shows: a cover put in a tier
 * stays there. Each tier can wear a colour, a border and an icon, and the card draws as banded rows
 * (`tiers`) or as a bookcase (`shelf`), one shelf a tier.
 */

export interface Tier {
	id: string
	name: string
	/** 1 to `MAX_WEIGHT`: how many times as often as a tier of weight 1 an item of it is drawn. */
	weight: number
	/** Its row's background colour (`TIER_COLORS`), or '' for the card's own. */
	color: string
	/** Its row's border colour (`TIER_COLORS`), or '' for none. */
	border: string
	/** Its icon (`TIER_ICONS` in tierLook.tsx), or '' for none. */
	icon: string
}

/** How a ranking is drawn: banded rows, or a bookcase with a shelf for each tier. */
export const DISPLAYS = [
	{ id: 'tiers', label: 'Tiers' },
	{ id: 'shelf', label: 'Shelf' },
] as const
export type Display = (typeof DISPLAYS)[number]['id']

export interface Ranking {
	rankingId: string
	/**
	 * The board it belongs to (DARK-14): only a card there offers it to a randomizer. '' for one made
	 * before rankings had boards, until the board showing it opens (`claimRanking`).
	 */
	boardId: string
	/** Its name in a randomizer's menu and in Settings. '' says it after its source. */
	name: string
	/** What it ranks, as a source key. '' for nothing yet. */
	source: string
	weighted: boolean
	/** Top first. */
	tiers: Tier[]
	/** Per source key, per tier id, the ids of the items in it, in order. Anything else is unranked. */
	placed: Record<string, Record<string, string[]>>
	/**
	 * Per stamp kind (`liked`, `unsure`, `disliked`), whether covers whose latest stamp is that kind wait
	 * in the queue (DARK-13, DARK-14). A kind not in here is shown, but on a ranking of a stamped list
	 * only that list's kind is (`showsStamp`). A cover already in a tier stays there whatever its stamp.
	 */
	stampFilter: Record<string, boolean>
	/** Each stamped cover wears its latest stamp. */
	badges: boolean
	/** The covers' shape, as the kit's `COVER_ASPECTS` names it: '' is square. */
	aspect: string
	display: Display
}

export const MAX_TIERS = 8
export const MAX_WEIGHT = 5
/** Where an item is when it is in no tier. */
export const UNRANKED = 'unranked'

/** What a new tier is made from: its name and weight, and its look if it has one. */
export type TierStart = Pick<Tier, 'name' | 'weight'> & Partial<Pick<Tier, 'color' | 'border' | 'icon'>>

/** The tiers a new ranking starts with, unless Settings says otherwise: listening tiers, heaviest first. */
export const DEFAULT_TIERS: readonly TierStart[] = [
	{ name: 'Heavy rotation', weight: 4, color: 'ember', icon: 'flame' },
	{ name: 'Often', weight: 3, color: 'teal', icon: 'repeat' },
	{ name: 'Now and then', weight: 2, color: 'amber', icon: 'clock' },
	{ name: 'Rarely', weight: 1, color: 'slate', icon: 'moon' },
]

/**
 * The colours a tier's row and border can take, by id: the bookcase design's nameplate enamels, and
 * two more. A tier stores the id, so the shades can be retuned without touching rankings.
 */
export const TIER_COLORS = [
	{ id: 'ember', label: 'Ember', value: '#b23a2a' },
	{ id: 'amber', label: 'Amber', value: '#96690f' },
	{ id: 'moss', label: 'Moss', value: '#2f6b3a' },
	{ id: 'teal', label: 'Teal', value: '#1f7a6e' },
	{ id: 'sky', label: 'Sky', value: '#2f6fa8' },
	{ id: 'slate', label: 'Slate', value: '#44558a' },
	{ id: 'plum', label: 'Plum', value: '#7a3f8c' },
	{ id: 'rose', label: 'Rose', value: '#a8436a' },
] as const

/** A colour id's shade, or `null` for none or one that is unknown. */
export function tierColor(id: string): string | null {
	return TIER_COLORS.find((c) => c.id === id)?.value ?? null
}

/** The colour a tier's nameplate wears on the shelf: its own, or one by its place, so no two neighbours match. */
export function plateColor(tier: Pick<Tier, 'color'>, index: number): string {
	return tierColor(tier.color) ?? TIER_COLORS[(index * 3) % TIER_COLORS.length]!.value
}

export function randomId(): string {
	const out = new Uint32Array(2)
	crypto.getRandomValues(out)
	return Array.from(out, (n) => n.toString(36)).join('')
}

export const clampWeight = (w: number): number => (Number.isFinite(w) ? Math.max(1, Math.min(MAX_WEIGHT, Math.round(w))) : 1)

/**
 * A ranking nobody has changed yet. Its tiers' ids are their places (`t1`, `t2`), so a card drawing one
 * before it is stored draws the same one each time; tiers added later get random ids.
 */
export function newRanking(rankingId: string, tiers: readonly TierStart[] = DEFAULT_TIERS, boardId = ''): Ranking {
	return {
		rankingId,
		boardId,
		name: '',
		source: '',
		weighted: false,
		tiers: tiers.slice(0, MAX_TIERS).map((t, i) => ({
			id: `t${i + 1}`,
			name: t.name,
			weight: clampWeight(t.weight),
			color: t.color ?? '',
			border: t.border ?? '',
			icon: t.icon ?? '',
		})),
		placed: {},
		stampFilter: {},
		badges: false,
		aspect: '',
		display: 'tiers',
	}
}

/* ------------------------------------------------------------------------------------ stamps */

/**
 * Whether covers stamped `kind` show on this ranking. Its own choice if it made one; else every kind,
 * except on a ranking of the stamped lists (`stampSource`, the source id they are offered under), where
 * only the list it was pointed at shows, as it did before there were filters.
 */
export function showsStamp(ranking: Pick<Ranking, 'source' | 'stampFilter'>, kind: string, stampSource: string | null): boolean {
	const chosen = ranking.stampFilter[kind]
	if (chosen !== undefined) return chosen
	const list = stampedList(ranking.source, stampSource)
	return list ? list.kind === kind : true
}

/**
 * A stamped list's key taken apart: its kind, and what follows it (`|<board>|<source>`, DARK-14), or
 * `null` for a key that is no stamped list. A list from before DARK-14 is its kind alone.
 */
export function stampedList(key: string, stampSource: string | null): { kind: string; rest: string } | null {
	const prefix = `${stampSource}:`
	if (!stampSource || !key.startsWith(prefix)) return null
	const choice = key.slice(prefix.length)
	const bar = choice.indexOf('|')
	return bar < 0 ? { kind: choice, rest: '' } : { kind: choice.slice(0, bar), rest: choice.slice(bar) }
}

/** The same stamped list, of another kind: Liked on /mu/core to Unsure on /mu/core. */
export function siblingList(key: string, stampSource: string, kind: string): string {
	const list = stampedList(key, stampSource)
	return `${stampSource}:${kind}${list?.rest ?? ''}`
}

/**
 * The source keys a ranking reads: its own, and on a ranking of a stamped list, the same list of every
 * other kind, so a cover whose stamp changed is still found, and Liked and Unsure can be ranked together.
 */
export function rankedKeys(ranking: Pick<Ranking, 'source'>, stampSource: string | null, kinds: readonly string[]): string[] {
	if (!ranking.source) return []
	if (!stampSource || !ranksStamps(ranking, stampSource)) return [ranking.source]
	return [ranking.source, ...kinds.map((k) => siblingList(ranking.source, stampSource, k)).filter((key) => key !== ranking.source)]
}

/** Whether a ranking ranks the stamped lists themselves (`stampSource` is the id they are offered under). */
export function ranksStamps(ranking: Pick<Ranking, 'source'>, stampSource: string | null): boolean {
	return stampedList(ranking.source, stampSource) !== null
}

/** The ids a ranking has put in tiers, for its current source. */
export function placedIds(ranking: Pick<Ranking, 'source' | 'placed'>): Set<string> {
	return new Set(Object.values(ranking.placed[ranking.source] ?? {}).flat())
}

/** Entries of several lists as one, each id once, in the order the lists give them. */
export function mergeEntries(lists: ReadonlyArray<readonly SourceEntry[]>): SourceEntry[] {
	const seen = new Set<string>()
	const out: SourceEntry[] = []
	for (const list of lists) {
		for (const e of list) {
			if (seen.has(e.id)) continue
			seen.add(e.id)
			out.push(e)
		}
	}
	return out
}

/* ------------------------------------------------------------------------------------ reading */

export interface Band {
	tier: Tier
	items: SourceEntry[]
}

export interface RankingView {
	bands: Band[]
	/** In the source's own order. */
	unranked: SourceEntry[]
}

/** What isn't in a tier yet, split (DARK-14): what you stamped waits in the queue, the rest in the rail. */
export interface Unranked {
	/** Stamped, of a kind the ranking shows: newest stamp first. */
	queue: SourceEntry[]
	/** Never stamped, in the source's own order. */
	rail: SourceEntry[]
}

/**
 * The unranked split into the queue and the rail. A cover stamped a kind the ranking doesn't show is in
 * neither: switch Disliked off and the disliked wait nowhere, until it is switched back on.
 */
export function splitUnranked(unranked: readonly SourceEntry[], stampOf: (entry: SourceEntry) => ItemStamp | null | undefined, shows: (kind: string) => boolean): Unranked {
	const queue: Array<{ entry: SourceEntry; date: string; at: number }> = []
	const rail: SourceEntry[] = []
	unranked.forEach((entry, at) => {
		const stamp = stampOf(entry)
		if (!stamp) rail.push(entry)
		else if (shows(stamp.kind)) queue.push({ entry, date: stamp.date, at })
	})
	queue.sort((a, b) => b.date.localeCompare(a.date) || a.at - b.at)
	return { queue: queue.map((q) => q.entry), rail }
}

/**
 * The source's entries sorted into the ranking. An item the source no longer has is left out (and kept,
 * in case it comes back); an item placed twice is shown in the first tier that has it.
 */
export function rankingView(ranking: Ranking, entries: readonly SourceEntry[]): RankingView {
	const byId = new Map(entries.map((e) => [e.id, e]))
	const placed = ranking.placed[ranking.source] ?? {}
	const seen = new Set<string>()
	const bands = ranking.tiers.map((tier) => {
		const items: SourceEntry[] = []
		for (const id of placed[tier.id] ?? []) {
			const entry = byId.get(id)
			if (!entry || seen.has(id)) continue
			seen.add(id)
			items.push(entry)
		}
		return { tier, items }
	})
	return { bands, unranked: entries.filter((e) => !seen.has(e.id)) }
}

/**
 * Each tier's share of a weighted draw: its weight times its items, over the same for all tiers. So
 * "Often" with fourteen albums at 3 wins more draws than "Heavy rotation" with four at 4, though each
 * of its albums wins fewer. Unranked items are not in the draw.
 */
export function tierShares(bands: readonly Band[]): number[] {
	const sizes = bands.map((b) => b.tier.weight * b.items.length)
	const total = sizes.reduce((a, b) => a + b, 0)
	return sizes.map((s) => (total ? s / total : 0))
}

/** A chance as the card says it: "1 in 5", or "20%". */
export function formatOdds(p: number, percent: boolean): string {
	if (!p) return '—'
	if (percent) return p * 100 < 1 ? '<1%' : `${Math.round(p * 100)}%`
	return `1 in ${Math.max(1, Math.round(1 / p))}`
}

/** The ranked items with their tier's weight, top tier first: what a randomizer draws from. */
export function weightedEntries(ranking: Ranking, entries: readonly SourceEntry[]): SourceEntry[] {
	return rankingView(ranking, entries).bands.flatMap((band) => band.items.map((item) => ({ ...item, weight: band.tier.weight })))
}

/* ------------------------------------------------------------------------------------ changing */

/**
 * An item moved into a tier (or out of all of them, to `UNRANKED`), before another item of that tier
 * or at its end. Only the ranking's current source is touched.
 */
export function moveItem(ranking: Ranking, itemId: string, to: string, beforeId: string | null = null): Ranking {
	const placed = { ...(ranking.placed[ranking.source] ?? {}) }
	for (const tierId of Object.keys(placed)) {
		if (placed[tierId]!.includes(itemId)) placed[tierId] = placed[tierId]!.filter((id) => id !== itemId)
	}
	if (to !== UNRANKED && ranking.tiers.some((t) => t.id === to)) {
		const list = [...(placed[to] ?? [])]
		const at = beforeId === null ? -1 : list.indexOf(beforeId)
		list.splice(at < 0 ? list.length : at, 0, itemId)
		placed[to] = list
	}
	return { ...ranking, placed: { ...ranking.placed, [ranking.source]: placed } }
}

/** A tier below the last, of the lightest weight. `null` at `MAX_TIERS`. */
export function addTier(ranking: Ranking, name: string, newId: () => string = randomId): Ranking | null {
	if (ranking.tiers.length >= MAX_TIERS) return null
	const tier: Tier = { id: newId(), name: name.trim() || 'New tier', weight: 1, color: '', border: '', icon: '' }
	return { ...ranking, tiers: [...ranking.tiers, tier] }
}

/** A tier's colour, border or icon changed (DARK-14). An unknown colour or icon is stored as none. */
export function setTierLook(ranking: Ranking, tierId: string, look: Partial<Pick<Tier, 'color' | 'border' | 'icon'>>): Ranking {
	return { ...ranking, tiers: ranking.tiers.map((t) => (t.id === tierId ? { ...t, ...look } : t)) }
}

/** Everything in a tier back to unranked, for the current source: stamped covers return to the queue. */
export function emptyTier(ranking: Ranking, tierId: string): Ranking {
	const placed = { ...(ranking.placed[ranking.source] ?? {}) }
	delete placed[tierId]
	return { ...ranking, placed: { ...ranking.placed, [ranking.source]: placed } }
}

export function renameTier(ranking: Ranking, tierId: string, name: string): Ranking {
	const trimmed = name.trim()
	if (!trimmed) return ranking
	return { ...ranking, tiers: ranking.tiers.map((t) => (t.id === tierId ? { ...t, name: trimmed } : t)) }
}

export function setTierWeight(ranking: Ranking, tierId: string, weight: number): Ranking {
	return { ...ranking, tiers: ranking.tiers.map((t) => (t.id === tierId ? { ...t, weight: clampWeight(weight) } : t)) }
}

/** The die's click: one pip fewer, and from one back round to the most. */
export function nextWeight(weight: number): number {
	return weight <= 1 ? MAX_WEIGHT : clampWeight(weight - 1)
}

/** A tier one place up (`-1`) or down (`1`), its items with it. */
export function moveTier(ranking: Ranking, tierId: string, delta: -1 | 1): Ranking {
	const at = ranking.tiers.findIndex((t) => t.id === tierId)
	const to = at + delta
	if (at < 0 || to < 0 || to >= ranking.tiers.length) return ranking
	const tiers = [...ranking.tiers]
	;[tiers[at], tiers[to]] = [tiers[to]!, tiers[at]!]
	return { ...ranking, tiers }
}

/** A tier gone, for every source: its items are unranked again. Its last tier can't go. */
export function removeTier(ranking: Ranking, tierId: string): Ranking {
	if (ranking.tiers.length <= 1) return ranking
	const placed: Ranking['placed'] = {}
	for (const [key, tiers] of Object.entries(ranking.placed)) {
		const { [tierId]: _gone, ...rest } = tiers
		placed[key] = rest
	}
	return { ...ranking, tiers: ranking.tiers.filter((t) => t.id !== tierId), placed }
}

/* ------------------------------------------------------------------------------------ storing */

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** A stored ranking, checked: what can't be read is dropped rather than trusted. */
export function readRanking(raw: Record<string, unknown>): Ranking | null {
	const rankingId = str(raw.rankingId)
	if (!rankingId) return null
	const tiers = (Array.isArray(raw.tiers) ? raw.tiers : [])
		.filter(isObject)
		.map((t) => ({ id: str(t.id), name: str(t.name), weight: clampWeight(Number(t.weight)), color: str(t.color), border: str(t.border), icon: str(t.icon) }))
		.filter((t) => t.id)
		.slice(0, MAX_TIERS)
	if (!tiers.length) return null
	const placed: Ranking['placed'] = {}
	if (isObject(raw.placed)) {
		for (const [key, byTier] of Object.entries(raw.placed)) {
			if (!isObject(byTier)) continue
			const out: Record<string, string[]> = {}
			for (const [tierId, ids] of Object.entries(byTier)) {
				if (Array.isArray(ids)) out[tierId] = ids.filter((id): id is string => typeof id === 'string')
			}
			placed[key] = out
		}
	}
	const stampFilter: Record<string, boolean> = {}
	if (isObject(raw.stampFilter)) for (const [kind, on] of Object.entries(raw.stampFilter)) if (typeof on === 'boolean') stampFilter[kind] = on
	return {
		rankingId,
		boardId: str(raw.boardId),
		name: str(raw.name),
		source: str(raw.source),
		weighted: raw.weighted === true,
		tiers,
		placed,
		stampFilter,
		badges: raw.badges === true,
		aspect: str(raw.aspect),
		display: DISPLAYS.some((d) => d.id === raw.display) ? (raw.display as Display) : 'tiers',
	}
}
