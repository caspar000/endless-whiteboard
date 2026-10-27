import type { Editor, TLShapePartial } from '@lifeboard/canvas'
import {
	BOARD_ID_PARAM,
	defineOperation,
	fail,
	ok,
	reportAgentWork,
	resolveEditor,
	type JsonValue,
	type OperationContext,
	type RegisteredOperation,
} from '@lifeboard/node-kit'
import {
	addChip,
	boxLinks,
	boxOrder,
	CARD_TYPE,
	cardByZid,
	isBox,
	isCard,
	isSource,
	placeNote,
	findOrAddSource,
	shapeByZid,
	type CardShape,
	type SourceShape,
} from './box'
import { sourceLabel } from './card/Foot'
import { nameOf, plainOf, richTextFrom, titleOf } from './card/text'
import { compareZids, isCiteId, isZid, parentOf } from './ids'
import { inlineLinks, keywordKey } from './links'
import { getStack, isStackOpen, showCard } from './stack/state'

/**
 * The box for an agent (docs/zettelkasten-plan.md, phase 6): read it in order, read a note, write one
 * where it belongs, and tie it to the rest. Operations, so they are the agent's tools and MCP's too.
 *
 * The box's rules hold here as they do for a person: a note is only ever placed (its number is where
 * it goes), never moved, and every write is one undo step the person watching can take back.
 */

const NOT_A_BOX =
	'That board is not a Zettelkasten box. Open a box (they are made with New box), or pass its boardId.'

/** How much of a note's text the box listing carries; zettelkasten.note.get gives the rest. */
const PREVIEW_CHARS = 280

async function boxFor(ctx: OperationContext, boardId?: string): Promise<{ ok: true; editor: Editor } | { ok: false; error: string }> {
	const resolved = await resolveEditor(ctx, boardId)
	if (!resolved.ok) return resolved
	if (!isBox(resolved.editor)) return { ok: false, error: NOT_A_BOX }
	return resolved
}

/** A note id an agent wrote, tidied: `25A` and ` 25a ` are `25a`. */
function zidArg(text: string | undefined): string {
	return (text ?? '').trim().toLowerCase()
}

/** "There is no 25c; the nearest are 25b and 26." */
function missing(editor: Editor, zid: string): string {
	const ids = boxOrder(editor).filter((entry) => entry.kind === 'note').map((entry) => entry.zid)
	if (!ids.length) return `There is no note ${zid}: the box is empty. Place the first one with zettelkasten.note.place and no behind or branch.`
	const at = ids.findIndex((other) => compareZids(other, zid) > 0)
	const near = [ids[at - 1], ids[at]].filter(Boolean)
	return `There is no note ${zid} in this box. Nearby: ${near.join(', ')}. zettelkasten.box.read lists them all.`
}

/** Brings a card the agent just wrote or changed to the front, when the person is looking at the stack. */
function showWork(editor: Editor, zid: string): void {
	if (isStackOpen(editor) && !getStack(editor).chain && !getStack(editor).graph) showCard(editor, zid)
}

function noteJson(editor: Editor, card: CardShape, full: boolean): JsonValue {
	const { zid, richText, links = [], keywords = [], cites = [] } = card.props
	const text = plainOf(richText)
	const graph = boxLinks(editor)
	return {
		zid,
		title: titleOf(richText),
		text: full || text.length <= PREVIEW_CHARS ? text : `${text.slice(0, PREVIEW_CHARS)}…`,
		...(full || text.length <= PREVIEW_CHARS ? {} : { truncated: true }),
		links: [...new Set([...inlineLinks(richText), ...links])].filter((target) => target !== zid),
		keywords: [...keywords],
		cites: [...cites],
		linkedFrom: graph.linkedFrom.get(zid) ?? [],
	}
}

function sourceJson(editor: Editor, source: SourceShape): JsonValue {
	const { zid, author, title, year, note } = source.props
	return { zid, author, title, year, note, citedBy: boxLinks(editor).citedBy.get(zid) ?? [] }
}

export const boxOperations: readonly RegisteredOperation[] = [
	defineOperation({
		id: 'zettelkasten.box.read',
		title: 'Read a Zettelkasten box',
		description:
			'The notes of a Zettelkasten box in the box’s order, which is the order of its ids (1, 1a, 1a1, 1b, 2…): each with its title, its text (long ones cut short; zettelkasten.note.get gives all of it), what it links to, its keywords, the sources it cites and which notes link to it. Also the index (keywords to notes) and the sources. A note’s id says where it sits: 25a was written behind 25, 25a1 branches off 25a. While the person reads the box as a stack, the card in front of them is their selection in the turn’s context.',
		readOnly: true,
		params: {
			from: { type: 'string', description: 'Start at this note id instead of the first. For reading a long box a part at a time.' },
			count: { type: 'number', description: 'How many notes to give, at most. Default 60.' },
			boardId: BOARD_ID_PARAM,
		},
		run: async (ctx, args) => {
			const box = await boxFor(ctx, args.boardId)
			if (!box.ok) return fail(box.error)
			const { editor } = box
			const order = boxOrder(editor)
			const notes = order.filter((entry) => entry.kind === 'note')
			const start = args.from ? notes.findIndex((entry) => entry.zid === zidArg(args.from)) : 0
			if (start < 0) return fail(missing(editor, zidArg(args.from)))
			const count = Math.max(1, Math.min(500, Math.floor(args.count ?? 60)))
			const page = notes.slice(start, start + count)
			reportAgentWork(editor, 'read', 'zettelkasten.box.read', 'Reading', page.flatMap((entry) => (entry.id ? [entry.id] : [])))
			const sources = order.flatMap((entry) => {
				const shape = entry.id ? editor.getShape(entry.id) : undefined
				return isSource(shape) ? [sourceJson(editor, shape)] : []
			})
			return ok({
				notes: page.flatMap((entry) => {
					const card = entry.id ? editor.getShape(entry.id) : undefined
					return isCard(card) ? [noteJson(editor, card, false)] : []
				}),
				...(start + count < notes.length ? { more: notes.length - start - count, next: notes[start + count]!.zid } : {}),
				deleted: order.filter((entry) => entry.kind === 'gap').map((entry) => entry.zid),
				index: boxLinks(editor).index.map((entry) => ({ keyword: entry.keyword, notes: entry.zids })),
				sources,
			})
		},
	}),
	defineOperation({
		id: 'zettelkasten.note.get',
		title: 'Read a note in a box',
		description:
			'One note of a Zettelkasten box, all of its text, with the notes on either side of it in the box, the one it branched off and its branches, and its links, keywords and sources. A source (c1, c2…) can be read the same way.',
		readOnly: true,
		params: {
			zid: { type: 'string', description: 'The note’s id, e.g. "25a", or a source’s, e.g. "c1".', required: true },
			boardId: BOARD_ID_PARAM,
		},
		run: async (ctx, args) => {
			const box = await boxFor(ctx, args.boardId)
			if (!box.ok) return fail(box.error)
			const { editor } = box
			const zid = zidArg(args.zid)
			const shape = shapeByZid(editor, zid)
			if (!shape) return fail(isCiteId(zid) ? `There is no source ${zid} in this box.` : missing(editor, zid))
			reportAgentWork(editor, 'read', 'zettelkasten.note.get', 'Reading', [shape.id])
			if (isSource(shape)) return ok(sourceJson(editor, shape))
			const notes = boxOrder(editor).filter((entry) => entry.kind === 'note').map((entry) => entry.zid)
			const at = notes.indexOf(zid)
			return ok({
				...(noteJson(editor, shape as CardShape, true) as Record<string, JsonValue>),
				before: notes[at - 1] ?? null,
				after: notes[at + 1] ?? null,
				branchedOff: parentOf(zid),
				branches: notes.filter((other) => parentOf(other) === zid),
			})
		},
	}),
	defineOperation({
		id: 'zettelkasten.note.place',
		title: 'Write a note into a box',
		description:
			'Writes a new note into a Zettelkasten box where it belongs, and gives back the id it got. Its place is its id, so choose it: "behind" continues a note’s line (behind 25a comes 25b, or 25a1 if 25b is taken), "branch" always branches off it (25a1), and neither starts a new train of thought (the next top-level number). The first line, if it starts with "#", is the title; most notes need none. Link to other notes in the text as [[25a]]. One undo step.',
		params: {
			text: { type: 'string', description: 'What the note says. Plain text; "# Title" as the first line for a title; [[id]] for a link.', required: true },
			behind: { type: 'string', description: 'Place it behind this note, on its line.' },
			branch: { type: 'string', description: 'Place it as a branch off this note.' },
			boardId: BOARD_ID_PARAM,
		},
		run: async (ctx, args) => {
			const box = await boxFor(ctx, args.boardId)
			if (!box.ok) return fail(box.error)
			const { editor } = box
			if (args.behind && args.branch) return fail('Pass behind or branch, not both.')
			const from = zidArg(args.behind ?? args.branch)
			if (from && !isZid(from)) return fail(`"${from}" is not a note id. Ids look like 25, 25a, 25a1.`)
			if (from && !cardByZid(editor, from)) return fail(missing(editor, from))
			if (!args.text.trim()) return fail('The note has no text. Write what it says.')
			const { id, zid } = placeNote(editor, from ? (args.branch ? 'branch' : 'behind') : 'train', from || null)
			editor.updateShape({ id, type: CARD_TYPE, props: { richText: richTextFrom(args.text) } } as unknown as TLShapePartial)
			reportAgentWork(editor, 'create', 'zettelkasten.note.place', 'Writing', [id])
			showWork(editor, zid)
			return ok({ zid, placed: from ? `${args.branch ? 'as a branch off' : 'behind'} ${from}` : 'as a new train of thought' })
		},
	}),
	defineOperation({
		id: 'zettelkasten.note.write',
		title: 'Rewrite a note in a box',
		description:
			'Replaces what a note in a Zettelkasten box says. Its id, place, keywords and sources stay. "# Title" as the first line for a title; [[id]] for a link. One undo step.',
		params: {
			zid: { type: 'string', description: 'The note to rewrite, e.g. "25a".', required: true },
			text: { type: 'string', description: 'Its new text, whole.', required: true },
			boardId: BOARD_ID_PARAM,
		},
		run: async (ctx, args) => {
			const box = await boxFor(ctx, args.boardId)
			if (!box.ok) return fail(box.error)
			const { editor } = box
			const zid = zidArg(args.zid)
			const card = cardByZid(editor, zid)
			if (!card) return fail(missing(editor, zid))
			editor.markHistoryStoppingPoint('agent: rewrite a note')
			editor.updateShape({ id: card.id, type: CARD_TYPE, props: { richText: richTextFrom(args.text) } } as unknown as TLShapePartial)
			reportAgentWork(editor, 'update', 'zettelkasten.note.write', 'Writing', [card.id])
			showWork(editor, zid)
			return ok({ zid, name: nameOf(cardByZid(editor, zid)!.props.richText) })
		},
	}),
	defineOperation({
		id: 'zettelkasten.note.link',
		title: 'Link two notes in a box',
		description:
			'Links a note in a Zettelkasten box to another note (or a source), without changing its text: the link shows on the card’s foot, and the other card says it is linked from this one. To link inside the text instead, write [[id]] in it with zettelkasten.note.write. One undo step.',
		params: {
			zid: { type: 'string', description: 'The note the link goes from.', required: true },
			to: { type: 'string', description: 'The note or source it goes to.', required: true },
			boardId: BOARD_ID_PARAM,
		},
		run: async (ctx, args) => {
			const box = await boxFor(ctx, args.boardId)
			if (!box.ok) return fail(box.error)
			const { editor } = box
			const zid = zidArg(args.zid)
			const to = zidArg(args.to)
			const card = cardByZid(editor, zid)
			if (!card) return fail(missing(editor, zid))
			if (!shapeByZid(editor, to)) return fail(isCiteId(to) ? `There is no source ${to} in this box.` : missing(editor, to))
			if (to === zid) return fail('A note can’t link to itself.')
			addChip(editor, card.id, 'link', to)
			reportAgentWork(editor, 'connect', 'zettelkasten.note.link', 'Linking', [card.id, shapeByZid(editor, to)!.id])
			return ok({ from: zid, to })
		},
	}),
	defineOperation({
		id: 'zettelkasten.note.file',
		title: 'File a note under a keyword',
		description:
			'Files a note in a Zettelkasten box under an index keyword, as Luhmann’s index did: a few entry points into the box, not a tag on everything. Keywords already in the index are listed by zettelkasten.box.read; reuse one where it fits (case doesn’t matter). One undo step.',
		params: {
			zid: { type: 'string', description: 'The note to file.', required: true },
			keyword: { type: 'string', description: 'The keyword, e.g. "Society".', required: true },
			boardId: BOARD_ID_PARAM,
		},
		run: async (ctx, args) => {
			const box = await boxFor(ctx, args.boardId)
			if (!box.ok) return fail(box.error)
			const { editor } = box
			const zid = zidArg(args.zid)
			const card = cardByZid(editor, zid)
			if (!card) return fail(missing(editor, zid))
			if (!args.keyword.trim()) return fail('Name the keyword.')
			// Spelled as the index already spells it, when it is there in another case.
			const known = boxLinks(editor).index.find((entry) => keywordKey(entry.keyword) === keywordKey(args.keyword))
			addChip(editor, card.id, 'keyword', known?.keyword ?? args.keyword)
			reportAgentWork(editor, 'update', 'zettelkasten.note.file', 'Filing', [card.id])
			return ok({ zid, keyword: known?.keyword ?? args.keyword.trim(), new: !known })
		},
	}),
	defineOperation({
		id: 'zettelkasten.note.cite',
		title: 'Cite a source on a note',
		description:
			'Cites a source on a note in a Zettelkasten box. Name an existing source by its id (c1), or describe it with author, title and year: a source with the same author and title is reused, otherwise a new one is added at the back of the box. Gives back the source’s id. One undo step each for adding the source and citing it.',
		params: {
			zid: { type: 'string', description: 'The note that cites it.', required: true },
			source: { type: 'string', description: 'An existing source’s id, e.g. "c2".' },
			author: { type: 'string', description: 'For a source not in the box yet: who wrote it.' },
			title: { type: 'string', description: 'Its title.' },
			year: { type: 'string', description: 'When it came out.' },
			note: { type: 'string', description: 'Anything else: edition, pages, where it was found.' },
			boardId: BOARD_ID_PARAM,
		},
		run: async (ctx, args) => {
			const box = await boxFor(ctx, args.boardId)
			if (!box.ok) return fail(box.error)
			const { editor } = box
			const zid = zidArg(args.zid)
			const card = cardByZid(editor, zid)
			if (!card) return fail(missing(editor, zid))
			let source = args.source ? zidArg(args.source) : ''
			let added = false
			if (source) {
				if (!isSource(shapeByZid(editor, source))) return fail(`There is no source ${source} in this box. Describe it with author and title to add it.`)
			} else {
				if (!args.author?.trim() && !args.title?.trim()) return fail('Name a source by its id, or give at least its author or title.')
				const found = findOrAddSource(editor, { author: args.author, title: args.title, year: args.year, note: args.note })
				source = found.zid
				added = found.added
			}
			addChip(editor, card.id, 'cite', source)
			const shape = shapeByZid(editor, source) as SourceShape
			reportAgentWork(editor, 'connect', 'zettelkasten.note.cite', 'Citing', [card.id, shape.id])
			return ok({ zid, source, label: sourceLabel(shape.props.author, shape.props.title, shape.props.year), added })
		},
	}),
]
