import {
	atom,
	createComment,
	createCommentThread,
	toRichText,
	type Editor,
	type TLComment,
	type TLCommentAnchor,
	type TLCommentThread,
	type TLCommentThreadId,
	type TLRecord,
	type VecLike,
} from '@lifeboard/canvas'
import { currentAccount } from '../../server/accounts'

/**
 * Comments on a board (docs/fork-parity.md S7), in the data layer's own model: threads pinned to a
 * shape (following it) or to a spot on a page, comments in them, resolved and reopened. Every board's
 * store holds these records, so they sync, wait offline and travel in backups with it.
 *
 * Deleting marks rather than removes (`isDeleted`), so a deletion syncs like any change, and nothing
 * here is an undo step: ⌘Z takes back what you did to the board, not what you said about it. The
 * server makes each comment its author's (apps/server/src/boardWrites.ts).
 *
 * The store's record type doesn't list these types (registering them in the type map breaks the
 * data layer's own typing), so the store is read and written through the two casts below.
 */

const records = (editor: Editor) => editor.store.allRecords() as unknown as Array<{ typeName: string }>
const put = (editor: Editor, list: Array<TLCommentThread | TLComment>) =>
	editor.run(() => editor.store.put(list as unknown as TLRecord[]), { history: 'ignore' })

/** Who is writing: the account on a server board, `local` on a board that is only this device's. */
export function commenterId(): string {
	return currentAccount.get()?.id ?? 'local'
}

/** What the comments UI has open: placing a new thread, a draft, a thread, or nothing. */
export type CommentFocus =
	| { kind: 'placing' }
	| { kind: 'draft'; anchor: TLCommentAnchor; pageId: TLCommentThread['pageId'] }
	| { kind: 'thread'; threadId: TLCommentThreadId }
	| null

export const commentFocus = atom<CommentFocus>('lifeboard:comment-focus', null)
export const commentsPanelOpen = atom('lifeboard:comments-panel', false)

/** The board's threads that haven't been deleted, oldest first. */
export function threadsOf(editor: Editor): TLCommentThread[] {
	return (records(editor).filter((r) => r.typeName === 'comment-thread') as TLCommentThread[])
		.filter((thread) => !thread.isDeleted)
		.sort((a, b) => a.createdAt - b.createdAt)
}

export function threadById(editor: Editor, id: TLCommentThreadId): TLCommentThread | undefined {
	const thread = editor.store.get(id as never) as unknown as TLCommentThread | undefined
	return thread && !thread.isDeleted ? thread : undefined
}

/** A thread's comments that haven't been deleted, in order. */
export function commentsOf(editor: Editor, threadId: TLCommentThreadId): TLComment[] {
	return (records(editor).filter((r) => r.typeName === 'comment') as TLComment[])
		.filter((comment) => comment.threadId === threadId && !comment.isDeleted)
		.sort((a, b) => a.createdAt - b.createdAt)
}

/**
 * Where a click lands a new thread: on the topmost shape there, at that spot of it, or on the page.
 * Comments are about what's on the board, so a shape under the pointer is what one is about.
 */
export function anchorAt(editor: Editor, page: VecLike): TLCommentAnchor {
	const shape = editor.getShapeAtPoint(page, { hitInside: true, margin: 4 / editor.getZoomLevel() })
	const bounds = shape && editor.getShapePageBounds(shape)
	if (shape && bounds && bounds.w > 0 && bounds.h > 0) {
		return {
			type: 'shape',
			shapeId: shape.id,
			x: (page.x - bounds.minX) / bounds.w,
			y: (page.y - bounds.minY) / bounds.h,
			isPrecise: true,
		}
	}
	return { type: 'point', x: page.x, y: page.y }
}

/** Where a thread's pin is on its page now; `null` when it has no spot (its shape is gone, or it's page-wide). */
export function pinPoint(editor: Editor, anchor: TLCommentAnchor): VecLike | null {
	switch (anchor.type) {
		case 'point':
			return { x: anchor.x, y: anchor.y }
		case 'region':
			return { x: anchor.x + anchor.w * (anchor.pinX ?? 1), y: anchor.y + anchor.h * (anchor.pinY ?? 0) }
		case 'shape': {
			const bounds = editor.getShapePageBounds(anchor.shapeId)
			if (!bounds) return null
			// Not placed precisely: the top-right corner, just outside.
			return anchor.isPrecise
				? { x: bounds.minX + anchor.x * bounds.w, y: bounds.minY + anchor.y * bounds.h }
				: { x: bounds.maxX, y: bounds.minY }
		}
		case 'page':
			return null
	}
}

/** A new thread with its first comment. Nothing is written until there is something to say. */
export function startThread(
	editor: Editor,
	anchor: TLCommentAnchor,
	pageId: TLCommentThread['pageId'],
	text: string
): TLCommentThreadId {
	const thread = createCommentThread({ anchor, createdBy: commenterId(), pageId })
	const first = createComment({ authorId: commenterId(), body: toRichText(text), pageId, threadId: thread.id })
	put(editor, [thread, first])
	return thread.id
}

export function reply(editor: Editor, thread: TLCommentThread, text: string): void {
	put(editor, [createComment({ authorId: commenterId(), body: toRichText(text), pageId: thread.pageId, threadId: thread.id })])
}

export function editComment(editor: Editor, comment: TLComment, text: string): void {
	put(editor, [{ ...comment, body: toRichText(text), editedAt: Date.now() }])
}

/** A comment goes; the first takes its thread with it, as the thread is what it started. */
export function deleteComment(editor: Editor, comment: TLComment): void {
	const first = commentsOf(editor, comment.threadId)[0]
	const thread = threadById(editor, comment.threadId)
	if (first?.id === comment.id && thread) return deleteThread(editor, thread)
	put(editor, [{ ...comment, isDeleted: true }])
}

export function deleteThread(editor: Editor, thread: TLCommentThread): void {
	const mine = commentsOf(editor, thread.id).filter((comment) => comment.authorId === commenterId())
	put(editor, [{ ...thread, isDeleted: true }, ...mine.map((comment) => ({ ...comment, isDeleted: true }))])
	const focus = commentFocus.get()
	if (focus?.kind === 'thread' && focus.threadId === thread.id) commentFocus.set(null)
}

export function setResolved(editor: Editor, thread: TLCommentThread, resolved: boolean): void {
	put(editor, [{ ...thread, resolved: resolved ? { at: Date.now(), by: commenterId() } : null }])
}

/** A name's first letter, for a pin. */
export const initial = (name: string) => (name.trim()[0] ?? '?').toUpperCase()
