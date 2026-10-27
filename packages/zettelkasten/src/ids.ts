/**
 * Luhmann's note ids (Folgezettel): the address a note was given by where it was put.
 *
 * An id is a run of segments that alternate between a number and letters, starting with a number:
 * `25`, `25a`, `25a1`, `25a1a`. A note continues the line of the one before it by counting its last
 * segment on (`25a` → `25b`), and branches off it by adding a segment (`25a` → `25a1`). Letters count
 * in bijective base 26 (`a`…`z`, `aa`, `ab`…), so a note can have any number of branches.
 *
 * The order these sort in *is* the box: nothing else is stored to say where a note sits, so two
 * devices that agree on the ids agree on the order. See docs/zettelkasten-plan.md, "Ids".
 */

/** A number segment, or a letter segment as its letters. */
export type Segment = number | string

const ID = /^[1-9]\d*(?:[a-z]+[1-9]\d*)*[a-z]*$/
const SEGMENT = /[1-9]\d*|[a-z]+/g
/** A source's id: `c1`, `c2`… A series of its own, at the back of the box (Q7). */
const CITE = /^c([1-9]\d*)$/

export function isZid(text: string): boolean {
	return ID.test(text)
}

export function isCiteId(text: string): boolean {
	return CITE.test(text)
}

/** A note's id or a source's: anything the box can go to. */
export function isBoxId(text: string): boolean {
	return ID.test(text) || CITE.test(text)
}

/** The next source number nobody has had. `c1` in a box without sources. */
export function nextCite(taken: Iterable<string>): string {
	let max = 0
	for (const zid of taken) {
		const match = CITE.exec(zid)
		if (match) max = Math.max(max, Number(match[1]))
	}
	return `c${max + 1}`
}

/** The segments of an id, or `null` for something that isn't one. */
export function parseZid(zid: string): Segment[] | null {
	if (!ID.test(zid)) return null
	return (zid.match(SEGMENT) ?? []).map((part) => (/^\d/.test(part) ? Number(part) : part))
}

/** `a` is 1, `z` 26, `aa` 27. */
export function lettersToIndex(letters: string): number {
	let index = 0
	for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 96)
	return index
}

/** 1 is `a`, 26 `z`, 27 `aa`. */
export function indexToLetters(index: number): string {
	let letters = ''
	for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) {
		letters = String.fromCharCode(97 + ((n - 1) % 26)) + letters
	}
	return letters
}

function compareSegments(a: Segment, b: Segment): number {
	if (typeof a === 'number' && typeof b === 'number') return a - b
	if (typeof a === 'string' && typeof b === 'string') return lettersToIndex(a) - lettersToIndex(b)
	// Can't happen between two well-formed ids (segments alternate from the same start); numbers first.
	return typeof a === 'number' ? -1 : 1
}

/**
 * The box's order: segment by segment, and a note before its own branches. The sources come after
 * every note, by number. Anything that is neither goes last, in plain string order, so a malformed id
 * is still shown somewhere rather than lost.
 */
export function compareZids(a: string, b: string): number {
	const pa = parseZid(a)
	const pb = parseZid(b)
	const ca = CITE.exec(a)
	const cb = CITE.exec(b)
	if (ca && cb) return Number(ca[1]) - Number(cb[1])
	if (ca || cb) {
		if (pa) return -1
		if (pb) return 1
		return ca ? -1 : 1
	}
	if (!pa || !pb) {
		if (pa) return -1
		if (pb) return 1
		return a < b ? -1 : a > b ? 1 : 0
	}
	for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
		const diff = compareSegments(pa[i]!, pb[i]!)
		if (diff !== 0) return diff
	}
	return pa.length - pb.length
}

function format(segments: readonly Segment[]): string {
	return segments.map(String).join('')
}

/** How many branchings deep a note is: `25` is 0, `25a` 1, `25a1` 2. */
export function depthOf(zid: string): number {
	return (parseZid(zid)?.length ?? 1) - 1
}

/** The note this one branched off, or `null` for a top-level note. */
export function parentOf(zid: string): string | null {
	const segments = parseZid(zid)
	return segments && segments.length > 1 ? format(segments.slice(0, -1)) : null
}

/** The top-level note a note's line starts from: `25` for `25a1`. */
export function rootOf(zid: string): string {
	const segments = parseZid(zid)
	return segments ? String(segments[0]) : zid
}

/** The next note on the same line: `25a` → `25b`, `25` → `26`. */
export function nextOnLine(zid: string): string {
	const segments = parseZid(zid)
	if (!segments) throw new Error(`Not a note id: ${zid}`)
	const last = segments[segments.length - 1]!
	const next = typeof last === 'number' ? last + 1 : indexToLetters(lettersToIndex(last) + 1)
	return format([...segments.slice(0, -1), next])
}

/** The `n`th branch off a note (from 1): `25` → `25a`, `25a` → `25a1`. */
export function branchOf(zid: string, n: number): string {
	const segments = parseZid(zid)
	if (!segments) throw new Error(`Not a note id: ${zid}`)
	const last = segments[segments.length - 1]!
	return format([...segments, typeof last === 'number' ? indexToLetters(n) : n])
}

/** A note's first branch that nobody has had: not on a card now, and not retired. */
export function nextFreeBranch(zid: string, taken: ReadonlySet<string>): string {
	for (let n = 1; ; n++) {
		const id = branchOf(zid, n)
		if (!taken.has(id)) return id
	}
}

/**
 * Where "New note behind X" goes: on X's line if that place is free (`25a` → `25b`), otherwise X's
 * next free branch (`25a1`), which sorts after X's other branches. Either way it lands behind X and
 * before whatever already followed X on its line.
 */
export function placeBehind(zid: string, taken: ReadonlySet<string>): string {
	const next = nextOnLine(zid)
	return taken.has(next) ? nextFreeBranch(zid, taken) : next
}

/** The next top-level number nobody has had: a new train of thought. `1` in an empty box. */
export function nextTrain(taken: Iterable<string>): string {
	let max = 0
	for (const zid of taken) {
		const segments = parseZid(zid)
		if (segments) max = Math.max(max, segments[0] as number)
	}
	return String(max + 1)
}

/**
 * Where a note goes that has to move off its id, because another device gave the same id to a
 * different note while the two were apart (box.ts, `settleDuplicateIds`): straight behind the other
 * one, as if it had been written a moment later. A new train of thought takes the next train.
 */
export function placeAfterDuplicate(zid: string, taken: ReadonlySet<string>): string {
	return parentOf(zid) === null ? nextTrain(taken) : placeBehind(zid, taken)
}
