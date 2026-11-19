/**
 * What a randomizer card holds, and every rule about it that is not drawing: which list is which, how
 * a typed list becomes items, which items are still in the shuffle, the fair pick, and how long the
 * shuffle takes. Pure, so it is tested without a DOM and the card is left with only the drawing.
 */

export const LIST_IDS = ['albums', 'films', 'books'] as const
export type ListId = (typeof LIST_IDS)[number]

export interface ListKind {
	/** The switch's label. */
	label: string
	/** Plural, for the count: "12 albums". */
	noun: string
	/** Singular, for "Stamp this album". */
	one: string
	/** The label over the second row of tiles. */
	creator: string
	/** Shown beside the year: "1978 · LP". */
	tag: string
	/** The shape of a generated cover. Album art is square; posters and books are taller than wide. */
	shape: 'square' | 'poster' | 'book'
}

export const LISTS: Record<ListId, ListKind> = {
	albums: { label: 'Albums', noun: 'albums', one: 'album', creator: 'Artist', tag: 'LP', shape: 'square' },
	films: { label: 'Films', noun: 'films', one: 'film', creator: 'Director', tag: 'Film', shape: 'poster' },
	books: { label: 'Books', noun: 'books', one: 'book', creator: 'Author', tag: 'Book', shape: 'book' },
}

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
}

export interface RandomItem {
	id: string
	list: ListId
	title: string
	creator: string
	/** Free text, because "1978", "c. 1600" and "" are all things people write. */
	year: string
	/** `asset:<sha256>` for a dropped image, an `https:` URL for one dragged from a page, or `''`. */
	cover: string
	/** Oldest first. */
	stamps: Stamp[]
}

/** One shuffle's answer. The newest per list is the one on show; the next few are "Last picks". */
export interface RandomPick {
	list: ListId
	id: string
}

/** The one on show plus the four the design has room for under the button. */
export const PICKS_KEPT_PER_LIST = 5

export function itemsOf(items: readonly RandomItem[], list: ListId): RandomItem[] {
	return items.filter((item) => item.list === list)
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
export function inShuffle(items: readonly RandomItem[], list: ListId): RandomItem[] {
	return itemsOf(items, list).filter((item) => !isOut(item))
}

/** The item on show for a list: the newest pick that still exists, or else the list's first item. */
export function currentItem(items: readonly RandomItem[], picks: readonly RandomPick[], list: ListId): RandomItem | null {
	const ofList = itemsOf(items, list)
	for (const pick of picks) {
		if (pick.list !== list) continue
		const found = ofList.find((item) => item.id === pick.id)
		if (found) return found
	}
	return ofList[0] ?? null
}

/** The picks before the one on show, newest first, as far as they still exist. */
export function lastPicks(items: readonly RandomItem[], picks: readonly RandomPick[], list: ListId, count = PICKS_KEPT_PER_LIST - 1): RandomItem[] {
	const current = currentItem(items, picks, list)
	const out: RandomItem[] = []
	for (const pick of picks) {
		if (pick.list !== list || pick.id === current?.id || out.some((item) => item.id === pick.id)) continue
		const found = items.find((item) => item.id === pick.id && item.list === list)
		if (found) out.push(found)
		if (out.length === count) break
	}
	return out
}

/** Puts a new pick on top, dropping the oldest of that list's beyond what the card shows. */
export function recordPick(picks: readonly RandomPick[], pick: RandomPick): RandomPick[] {
	const next = [pick, ...picks.filter((p) => !(p.list === pick.list && p.id === pick.id))]
	let kept = 0
	return next.filter((p) => p.list !== pick.list || ++kept <= PICKS_KEPT_PER_LIST)
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
 * The next pick: any item still in the shuffle, never the one already on show (when there is another
 * to choose). `null` when nothing is left.
 */
export function pickNext(
	items: readonly RandomItem[],
	list: ListId,
	currentId: string | null,
	words: RandomWords = cryptoWords
): RandomItem | null {
	const pool = inShuffle(items, list)
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

export function formatList(items: readonly RandomItem[], list: ListId): string {
	return itemsOf(items, list).map(formatLine).join('\n')
}

const keyOf = (title: string, creator: string) => `${title.trim().toLowerCase()}\u0000${creator.trim().toLowerCase()}`

/**
 * The list as typed, merged over what the card already held for it.
 *
 * Matching is by title and creator, so editing a year keeps an item's cover and stamps, and so does
 * moving its line. A line that matches nothing is a new item. Other lists are left as they were.
 */
export function mergeList(
	items: readonly RandomItem[],
	list: ListId,
	text: string,
	newId: () => string = randomId
): RandomItem[] {
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
		next.push(match ? { ...match, ...parsed } : { id: newId(), list, ...parsed, cover: '', stamps: [] })
	}
	return [...items.filter((item) => item.list !== list), ...next]
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
