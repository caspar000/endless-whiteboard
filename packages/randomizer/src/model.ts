/**
 * What a randomizer card holds, and every rule about it that is not drawing: how a typed list becomes
 * items, how a source's entries meet the card's stamps, which items are still in the shuffle, the
 * fair pick, and how long the shuffle takes. Pure, so it is tested without a DOM and the card is left
 * with only the drawing.
 *
 * A card shuffles one **source** (DARK-7): a list typed into it, or whatever another extension offers
 * (`sources.ts`), such as a feed's videos. Which one is a string, the source key: `''` for none yet,
 * `list` for the typed list, `<source id>:<choice id>` for the rest.
 */

import { PLAIN_KIND, type SourceEntry, type SourceKind } from '@lifeboard/node-kit'

/** No source chosen yet: the card waits for one. */
export const NO_SOURCE = ''
/** The list typed into the card itself. */
export const TYPED_SOURCE = 'list'

export { parseSourceKey, sourceKey, type SourceEntry, type SourceKind } from '@lifeboard/node-kit'

/** A typed list holds anything, so it says nothing about what its items are. */
export const TYPED_KIND: SourceKind = PLAIN_KIND

export const STAMP_KINDS = ['liked', 'disliked', 'unsure'] as const
export type StampKind = (typeof STAMP_KINDS)[number]

export interface StampKindInfo {
	label: string
	/** The word round the top of the postmark. */
	word: string
	/** The ink. Fixed rather than a theme token: a green stamp is green on any board. */
	ink: string
	/** The key that picks it while the stamp menu is open. */
	key: string
	/** Stamped this, the item leaves the shuffle. */
	out: boolean
}

export const STAMPS: Record<StampKind, StampKindInfo> = {
	liked: { label: 'Liked', word: 'LIKED', ink: '#2f9e44', key: '1', out: true },
	disliked: { label: 'Disliked', word: 'DISLIKED', ink: '#e03131', key: '2', out: true },
	unsure: { label: 'Unsure', word: 'UNSURE', ink: '#f08c00', key: '3', out: false },
}

export interface Stamp {
	kind: StampKind
	/** The local day it was stamped, `YYYY-MM-DD`. A postmark is dated to the day, not the second. */
	date: string
	/**
	 * Stamped by ranking the item on a Ranking Tiers card (DARK-13), not on this card. It counts here
	 * as any stamp does (out of the shuffle, on the cover), but it is the vault's, and never stored on
	 * the card (`storeItem` leaves it out, `withRankings` puts it in).
	 */
	ranked?: boolean
}

export interface RandomItem {
	id: string
	/** The source key it belongs to: `list` for a typed line, `feeds:all` for a video. */
	source: string
	title: string
	creator: string
	/** Free text, because "1978", "c. 1600" and "" are all things people write. */
	year: string
	/** `asset:<sha256>` for a dropped image, an `https:` URL for one dragged from a page, or `''`. */
	cover: string
	/** Oldest first. */
	stamps: Stamp[]
	/** Where the item opens (a video). Only a source's entries have one, and it is never stored. */
	url?: string
	/** The source's line beside the year ("11 tracks"). Never stored. */
	detail?: string
	/** How heavily a draw favours it: a weighted ranking's tier (DARK-11). The source's, never stored. */
	weight?: number
}

/** One shuffle's answer. The newest per source is the one on show; the next few are "Last picks". */
export interface RandomPick {
	source: string
	id: string
}

/** The one on show plus the four the design has room for under the button. */
export const PICKS_KEPT_PER_SOURCE = 5

export function itemsOf(items: readonly RandomItem[], source: string): RandomItem[] {
	return items.filter((item) => item.source === source)
}

export function latestStamp(item: RandomItem): Stamp | null {
	return item.stamps[item.stamps.length - 1] ?? null
}

/** Liked and Disliked take an item out; Unsure, or no stamp at all, leaves it in. */
export function isOut(item: RandomItem): boolean {
	const latest = latestStamp(item)
	return latest !== null && STAMPS[latest.kind].out
}

/**
 * The items a shuffle may land on. Only the latest stamp counts, which is what makes "Unsure, then
 * Liked" take an item out and "Liked" undone put it back.
 */
export function inShuffle(items: readonly RandomItem[], source: string): RandomItem[] {
	return itemsOf(items, source).filter((item) => !isOut(item))
}

/** The item on show for a source: the newest pick that still exists, or else the source's first item. */
export function currentItem(items: readonly RandomItem[], picks: readonly RandomPick[], source: string): RandomItem | null {
	const ofList = itemsOf(items, source)
	for (const pick of picks) {
		if (pick.source !== source) continue
		const found = ofList.find((item) => item.id === pick.id)
		if (found) return found
	}
	return ofList[0] ?? null
}

/** The picks before the one on show, newest first, as far as they still exist. */
export function lastPicks(items: readonly RandomItem[], picks: readonly RandomPick[], source: string, count = PICKS_KEPT_PER_SOURCE - 1): RandomItem[] {
	const current = currentItem(items, picks, source)
	const out: RandomItem[] = []
	for (const pick of picks) {
		if (pick.source !== source || pick.id === current?.id || out.some((item) => item.id === pick.id)) continue
		const found = items.find((item) => item.id === pick.id && item.source === source)
		if (found) out.push(found)
		if (out.length === count) break
	}
	return out
}

/** Puts a new pick on top, dropping the oldest of that source's beyond what the card shows. */
export function recordPick(picks: readonly RandomPick[], pick: RandomPick): RandomPick[] {
	const next = [pick, ...picks.filter((p) => !(p.source === pick.source && p.id === pick.id))]
	let kept = 0
	return next.filter((p) => p.source !== pick.source || ++kept <= PICKS_KEPT_PER_SOURCE)
}

/** How random numbers arrive. A parameter so the rejection branch can be tested at all. */
export type RandomWords = (out: Uint32Array) => void

const cryptoWords: RandomWords = (out) => {
	crypto.getRandomValues(out)
}

/**
 * A uniformly random index below `n`.
 *
 * Rejection sampling, as the dice do it (`@lifeboard/dice`'s `randomFace`), for the same reason:
 * `word % n` favours the low indexes whenever 2³² is not a multiple of `n`. A long backlog is
 * exactly where that would show, so draws in the short tail are thrown away instead.
 */
export function randomIndex(n: number, words: RandomWords = cryptoWords): number {
	if (!Number.isInteger(n) || n < 1) throw new Error(`randomIndex: ${n} is not a count`)
	const range = 2 ** 32
	const limit = Math.floor(range / n) * n
	const out = new Uint32Array(1)
	for (;;) {
		words(out)
		const draw = out[0] ?? 0
		if (draw < limit) return draw % n
	}
}

/**
 * An index below `weights.length`, each as likely as its weight (DARK-11): a ranking's "Heavy
 * rotation" at 4 comes up four times as often as "Rarely" at 1. Weights are whole numbers, so this is
 * one fair draw over their sum and no rounding favours anything.
 */
export function weightedIndex(weights: readonly number[], words: RandomWords = cryptoWords): number {
	const whole = weights.map((w) => (Number.isFinite(w) ? Math.max(0, Math.round(w)) : 0))
	const total = whole.reduce((a, b) => a + b, 0)
	if (total === 0) return randomIndex(weights.length, words)
	let draw = randomIndex(total, words)
	for (let i = 0; i < whole.length; i++) {
		draw -= whole[i]!
		if (draw < 0) return i
	}
	return whole.length - 1
}

/** Whether a source weighs its items: a ranking with weighted shuffle on. */
export function isWeighted(items: readonly RandomItem[]): boolean {
	return items.some((item) => item.weight !== undefined)
}

/**
 * The next pick, from the items still in the shuffle. `null` when nothing is left.
 *
 * Drawn evenly, it is never the one already on show (when there is another to choose). Drawn by
 * weight (a ranking with weighted shuffle on), it is from the whole pool, the one on show included:
 * leaving it out would turn "Heavy rotation, four times as often" into taking turns, two albums of
 * weights 4 and 1 coming up alternately. The tiers' odds on the ranking are the odds of every draw.
 */
export function pickNext(
	items: readonly RandomItem[],
	source: string,
	currentId: string | null,
	words: RandomWords = cryptoWords
): RandomItem | null {
	const pool = inShuffle(items, source)
	if (isWeighted(pool)) return pool.length ? (pool[weightedIndex(pool.map((item) => item.weight ?? 1), words)] ?? null) : null
	const choices = pool.length > 1 ? pool.filter((item) => item.id !== currentId) : pool
	if (choices.length === 0) return null
	return choices[randomIndex(choices.length, words)] ?? null
}

/** How many covers flip past for a list this long: about 24 for a dozen, up to 80 for a backlog. */
export function flipCount(listLength: number): number {
	const scaled = Math.round(8 * Math.log2(listLength + 1) - 6)
	return Math.max(6, Math.min(80, scaled))
}

/** The whole shuffle stays under this, however long the list. */
export const MAX_SHUFFLE_MS = 5000

/**
 * How long each flip takes, in order: a short wind-up, a fast run, and a tail that slows to a stop.
 *
 * The slowing tail is the same length in *time* whatever the count: the curve's exponent grows with
 * the number of flips, so a longer list adds fast flips in the middle rather than more slow ones at
 * the end. The fast flips then shorten until the whole thing fits in `MAX_SHUFFLE_MS`.
 */
export function flipDurations(count: number): number[] {
	const n = Math.max(1, Math.round(count))
	if (n === 1) return [360]
	const exponent = 2.6 * Math.max(1, n / 24)
	const tail = (i: number) => 300 * Math.pow(i / (n - 1), exponent)
	const tailTotal = Array.from({ length: n }, (_, i) => tail(i)).reduce((a, b) => a + b, 0)
	const windUp = [150, 105, 72].slice(0, n > 3 ? 3 : 0)
	const windUpTotal = windUp.reduce((a, b) => a + b, 0)
	const fast = Math.max(18, Math.min(40, (MAX_SHUFFLE_MS - 200 - tailTotal - windUpTotal) / n))
	return Array.from({ length: n }, (_, i) => Math.round(windUp[i] ?? fast + tail(i)))
}

/**
 * The covers that flip past before the answer: drawn from the whole list so a short pool still
 * looks busy, never the same twice running, never the answer just before it lands, and ending on it.
 */
export function flipSequence(
	listIds: readonly string[],
	fromId: string | null,
	targetId: string,
	count: number,
	words: RandomWords = cryptoWords
): string[] {
	const seq: string[] = []
	let prev = fromId
	for (let i = 0; i < count - 1; i++) {
		const choices = listIds.filter((id) => id !== prev && !(i === count - 2 && id === targetId))
		const next = choices.length ? choices[randomIndex(choices.length, words)]! : prev ?? targetId
		seq.push(next)
		prev = next
	}
	seq.push(targetId)
	return seq
}

/* ------------------------------------------------------------------------------ the typed list */

/**
 * One line, one item: `Title — Artist — Year`. An em dash, an en dash, a hyphen with spaces round it,
 * a tab or a `|` all separate, because that is what lists pasted from elsewhere use. A line of two
 * parts whose second is a year is a title and a year.
 */
export function parseLine(line: string): { title: string; creator: string; year: string } | null {
	const text = line.trim().replace(/^[-*•]\s+|^\d+[.)]\s+/, '')
	if (!text) return null
	const parts = text.split(/\s+[—–-]\s+|\s*[—–|\t]\s*/).map((part) => part.trim())
	const [title = '', second = '', third = ''] = parts
	if (!title) return null
	if (parts.length === 2 && /^\d{4}$/.test(second)) return { title, creator: '', year: second }
	return { title, creator: second, year: third }
}

/**
 * The line `parseLine` reads back as the same item: the list editor shows this, and a save that
 * read an item back differently would match it to nothing and drop its cover and stamps.
 *
 * Two parts are ambiguous, because a four-digit second part is read as a year. So a year with no
 * creator keeps the empty creator (`Title — — c. 1600`) unless it is four digits, and a creator that
 * is four digits (a band called 1349) gets an empty year after it.
 */
export function formatLine(item: Pick<RandomItem, 'title' | 'creator' | 'year'>): string {
	const { title, creator, year } = item
	if (year) return creator || /^\d{4}$/.test(year) ? [title, creator, year].filter(Boolean).join(' — ') : `${title} — — ${year}`
	if (creator) return /^\d{4}$/.test(creator) ? `${title} — ${creator} —` : `${title} — ${creator}`
	return title
}

export function formatList(items: readonly RandomItem[]): string {
	return itemsOf(items, TYPED_SOURCE).map(formatLine).join('\n')
}

const keyOf = (title: string, creator: string) => `${title.trim().toLowerCase()}\u0000${creator.trim().toLowerCase()}`

/**
 * The list as typed, merged over what the card already held for it.
 *
 * Matching is by title and creator, so editing a year keeps an item's cover and stamps, and so does
 * moving its line. A line that matches nothing is a new item. What the card keeps for other sources
 * (stamps on a feed's videos) is left as it was.
 */
export function mergeList(items: readonly RandomItem[], text: string, newId: () => string = randomId): RandomItem[] {
	const list = TYPED_SOURCE
	const before = itemsOf(items, list)
	const unused = new Map<string, RandomItem[]>()
	for (const item of before) {
		const key = keyOf(item.title, item.creator)
		unused.set(key, [...(unused.get(key) ?? []), item])
	}
	const next: RandomItem[] = []
	for (const line of text.split('\n')) {
		const parsed = parseLine(line)
		if (!parsed) continue
		const key = keyOf(parsed.title, parsed.creator)
		const match = unused.get(key)?.shift()
		next.push(match ? { ...match, ...parsed } : { id: newId(), source: list, ...parsed, cover: '', stamps: [] })
	}
	return [...items.filter((item) => item.source !== list), ...next]
}

/* ------------------------------------------------------------------------ another source's items */

/**
 * A source's entries as the card's items: each with the stamps the card has put on it, and the
 * picture dropped on it, if any, over the source's own.
 *
 * The card stores nothing for an entry it hasn't stamped or covered, so a feed's sixty videos cost
 * the board nothing until one is stamped.
 */
export function withEntries(stored: readonly RandomItem[], source: string, entries: readonly SourceEntry[]): RandomItem[] {
	const mine = new Map(itemsOf(stored, source).map((item) => [item.id, item]))
	return entries.map((entry) => {
		const kept = mine.get(entry.id)
		return {
			id: entry.id,
			source,
			title: entry.title,
			creator: entry.creator,
			year: entry.year,
			cover: kept?.cover || entry.cover,
			stamps: kept?.stamps ?? [],
			...(entry.url ? { url: entry.url } : {}),
			...(entry.detail ? { detail: entry.detail } : {}),
			...(entry.weight !== undefined ? { weight: entry.weight } : {}),
		}
	})
}

/**
 * The card's items with one item changed (stamped, unstamped, given a cover), as they are stored.
 *
 * A typed item is stored whole, as it always was. Another source's entry is stored only while it
 * carries something of the card's own (a stamp, a dropped picture), with its title kept so a stamp
 * means something on its own; its `url` and the source's picture are the source's, and stay there.
 */
export function storeItem(stored: readonly RandomItem[], item: RandomItem, change: Partial<Pick<RandomItem, 'stamps' | 'cover'>>): RandomItem[] {
	const next = { ...item, ...change }
	const at = stored.findIndex((s) => s.id === item.id && s.source === item.source)
	// The item on the card shows the source's picture when none was dropped on it; only a dropped one
	// is the card's to keep.
	const ownCover = next.source === TYPED_SOURCE || change.cover !== undefined ? next.cover : (stored[at]?.cover ?? '')
	const kept: RandomItem = {
		id: next.id,
		source: next.source,
		title: next.title,
		creator: next.creator,
		year: next.year,
		cover: ownCover,
		stamps: next.stamps.filter((s) => !s.ranked),
	}
	const keep = next.source === TYPED_SOURCE || kept.stamps.length > 0 || kept.cover !== ''
	if (at < 0) return keep ? [...stored, kept] : [...stored]
	return keep ? stored.map((s, i) => (i === at ? kept : s)) : stored.filter((_, i) => i !== at)
}

/**
 * The card's items with the stamps rankings gave them (DARK-13) among their own, by day, a ranking's
 * after the card's on the same day. A ranked album is Liked on every card: out of the shuffle, with the
 * stamp on its cover.
 */
export function withRankings(items: readonly RandomItem[], rankedOf: (item: RandomItem) => readonly Stamp[]): RandomItem[] {
	return items.map((item) => {
		const ranked = rankedOf(item)
		if (!ranked.length) return item
		const stamps = [...item.stamps.map((s, i) => ({ s, i })), ...ranked.map((s, i) => ({ s: { ...s, ranked: true }, i: item.stamps.length + i }))]
			.sort((a, b) => a.s.date.localeCompare(b.s.date) || a.i - b.i)
			.map(({ s }) => s)
		return { ...item, stamps }
	})
}

/** The card's own stamps on an item, without those rankings gave it. */
export const ownStamps = (item: RandomItem): Stamp[] => item.stamps.filter((s) => !s.ranked)

/* ------------------------------------------------------------------------ cards made before DARK-7 */

/** What a card stored when it had the Albums / Films / Books switch. */
export interface ThreeListProps {
	list?: string
	items?: Array<Record<string, unknown> & { list?: string }>
	picks?: Array<Record<string, unknown> & { list?: string }>
}

/**
 * A card from before DARK-7, as one typed list: the switch was all that kept the three apart.
 *
 * Every item and every stamp is kept. The list that was on show goes first, so the card opens on the
 * same item it showed; the others follow. A card that held nothing waits for a source, as a new one
 * does.
 */
export function oneTypedList(props: ThreeListProps): { source: string; items: Array<Record<string, unknown>>; picks: Array<Record<string, unknown>> } {
	const shown = props.list ?? 'albums'
	const items = props.items ?? []
	const first = [...items.filter((i) => i.list === shown), ...items.filter((i) => i.list !== shown)]
	const picks = [...(props.picks ?? []).filter((p) => p.list === shown), ...(props.picks ?? []).filter((p) => p.list !== shown)]
	const retag = <T extends { list?: string }>({ list: _list, ...rest }: T) => ({ ...rest, source: TYPED_SOURCE })
	return { source: items.length ? TYPED_SOURCE : NO_SOURCE, items: first.map(retag), picks: picks.map(retag).slice(0, PICKS_KEPT_PER_SOURCE) }
}

export function randomId(): string {
	const out = new Uint32Array(2)
	crypto.getRandomValues(out)
	return Array.from(out, (n) => n.toString(36)).join('')
}

/* ------------------------------------------------------------------------------------ dates */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The local day, `YYYY-MM-DD`. */
export function localDay(date: Date = new Date()): string {
	const pad = (n: number) => String(n).padStart(2, '0')
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function dayParts(iso: string): { y: number; m: number; d: number } {
	const [y = 0, m = 1, d = 1] = iso.split('-').map(Number)
	return { y, m, d }
}

/** As a postmark prints it: `19 NOV 26`. */
export function postmarkDate(iso: string): string {
	const { y, m, d } = dayParts(iso)
	return `${String(d).padStart(2, '0')} ${(MONTHS[m - 1] ?? '').toUpperCase()} ${String(y).slice(-2)}`
}

/** As the timeline says it: `19 Nov`. */
export function shortDate(iso: string): string {
	const { m, d } = dayParts(iso)
	return `${d} ${MONTHS[m - 1] ?? ''}`
}
