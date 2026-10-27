import { richTextToPlainText, type TLRichText } from '@lifeboard/canvas'
import { compareZids, isBoxId } from './ids'

/**
 * What ties a note to the rest of the box besides its place (docs/zettelkasten-plan.md, Q5–Q7, Q13):
 * links to other notes, keywords that file it in the index, and the sources it cites.
 *
 * A link is written in the text as `[[25a]]`, the way the `{…}` expressions are: plain text, which
 * search, export, copy and paste all carry without knowing about it, and which still reads as what it
 * is on a board where this extension is off. The card draws it as a chip. A link added with the card's
 * **+** is kept on the card instead (`links`), for linking without saying so in the text.
 */

/** `[[25a]]`, with room for spaces inside the brackets. */
export const LINK_PATTERN = /\[\[\s*([0-9a-z]+)\s*\]\]/gi

const inlineCache = new WeakMap<object, string[]>()

/** The ids a note's text links to, in the order they are written, each once. */
export function inlineLinks(richText: TLRichText): string[] {
	const cached = inlineCache.get(richText as object)
	if (cached) return cached
	const found: string[] = []
	for (const match of richTextToPlainText(richText).matchAll(LINK_PATTERN)) {
		const zid = match[1]!.toLowerCase()
		if (isBoxId(zid) && !found.includes(zid)) found.push(zid)
	}
	inlineCache.set(richText as object, found)
	return found
}

/** What the link graph needs to know about one note. */
export interface LinkedNote {
	zid: string
	richText: TLRichText
	links: readonly string[]
	keywords: readonly string[]
	cites: readonly string[]
}

/** Every note a note points at: what its text links to, then what was added with **+**. Never itself. */
export function outgoingLinks(note: LinkedNote): string[] {
	const out: string[] = []
	for (const zid of [...inlineLinks(note.richText), ...note.links]) {
		if (zid !== note.zid && !out.includes(zid)) out.push(zid)
	}
	return out
}

/** A keyword as typed, tidied: no space at either end or doubled inside. */
export function tidyKeyword(text: string): string {
	return text.trim().replace(/\s+/g, ' ')
}

/** Two keywords are one if they differ only in case. */
export function keywordKey(text: string): string {
	return tidyKeyword(text).toLocaleLowerCase()
}

export interface IndexEntry {
	/** As the first note filed under it spells it. */
	keyword: string
	/** The notes filed under it, in box order. */
	zids: string[]
}

export interface LinkGraph {
	/** For each note or source, the notes that link to it, in box order. */
	linkedFrom: Map<string, string[]>
	/** For each source, the notes that cite it, in box order. */
	citedBy: Map<string, string[]>
	/** The index: every keyword, A to Z, with the notes filed under it. */
	index: IndexEntry[]
}

function push(map: Map<string, string[]>, key: string, value: string): void {
	const list = map.get(key)
	if (!list) map.set(key, [value])
	else if (!list.includes(value)) list.push(value)
}

/** The box's links, citations and index, worked out from its notes. Pure, so it can be tested and cached. */
export function linkGraph(notes: readonly LinkedNote[]): LinkGraph {
	const ordered = [...notes].sort((a, b) => compareZids(a.zid, b.zid))
	const linkedFrom = new Map<string, string[]>()
	const citedBy = new Map<string, string[]>()
	const keywords = new Map<string, IndexEntry>()
	for (const note of ordered) {
		for (const target of outgoingLinks(note)) push(linkedFrom, target, note.zid)
		for (const source of note.cites) push(citedBy, source, note.zid)
		for (const keyword of note.keywords) {
			const key = keywordKey(keyword)
			if (!key) continue
			const entry = keywords.get(key)
			if (!entry) keywords.set(key, { keyword: tidyKeyword(keyword), zids: [note.zid] })
			else if (!entry.zids.includes(note.zid)) entry.zids.push(note.zid)
		}
	}
	const index = [...keywords.values()].sort((a, b) =>
		a.keyword.localeCompare(b.keyword, undefined, { sensitivity: 'base', numeric: true })
	)
	return { linkedFrom, citedBy, index }
}
