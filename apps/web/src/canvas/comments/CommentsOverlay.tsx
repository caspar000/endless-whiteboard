import { richTextToPlainText, useEditor, useValue, type TLComment, type TLCommentThread } from '@lifeboard/canvas'
import { Check, MoreHorizontal, RotateCcw, Send, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { ago, authorName } from '../boardPeople'
import {
	anchorAt,
	commentFocus,
	commenterId,
	commentsOf,
	deleteComment,
	deleteThread,
	editComment,
	initial,
	pinPoint,
	reply,
	setResolved,
	startThread,
	threadById,
	threadsOf,
} from './comments'

/**
 * Comments over the canvas (docs/fork-parity.md S7): a pin for each open thread on this page, where
 * it's pinned (following its shape), and the thread that's open beside its pin. While a comment is
 * being placed, a click anywhere puts it there.
 */
export function CommentsOverlay() {
	const editor = useEditor()
	const focus = useValue('lifeboard:comment-focus', () => commentFocus.get(), [])

	const pins = useValue(
		'lifeboard:comment-pins',
		() => {
			const pageId = editor.getCurrentPageId()
			editor.getCamera()
			const open = focus?.kind === 'thread' ? focus.threadId : null
			return threadsOf(editor).flatMap((thread) => {
				if (thread.pageId !== pageId || (thread.resolved && thread.id !== open)) return []
				const at = pinPoint(editor, thread.anchor)
				const comments = commentsOf(editor, thread.id)
				if (!at || !comments.length) return []
				const { x, y } = editor.pageToViewport(at)
				return [{ id: thread.id, x, y, author: comments[0]!.authorId, count: comments.length }]
			})
		},
		[editor, focus]
	)

	const draftPoint = useValue(
		'lifeboard:comment-draft',
		() => {
			editor.getCamera()
			if (focus?.kind !== 'draft') return null
			const at = pinPoint(editor, focus.anchor)
			return at ? editor.pageToViewport(at) : null
		},
		[editor, focus]
	)

	// Escape leaves placing, or closes what's open.
	useEffect(() => {
		if (!focus) return
		const onKey = (event: globalThis.KeyboardEvent) => {
			if (event.key === 'Escape') commentFocus.set(null)
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [focus])

	const place = (event: ReactPointerEvent) => {
		event.stopPropagation()
		const page = editor.screenToPage({ x: event.clientX, y: event.clientY })
		commentFocus.set({ kind: 'draft', anchor: anchorAt(editor, page), pageId: editor.getCurrentPageId() })
	}

	const openPin = focus?.kind === 'thread' ? pins.find((pin) => pin.id === focus.threadId) : undefined

	return (
		<div className="lb-comments" data-testid="lb.comments-layer">
			{focus?.kind === 'placing' && (
				<div className="lb-comments__capture" onPointerDown={place} title="Click where the comment goes" />
			)}
			{pins.map((pin) => (
				<button
					key={pin.id}
					className={focus?.kind === 'thread' && focus.threadId === pin.id ? 'lb-comment-pin lb-comment-pin--open' : 'lb-comment-pin'}
					style={{ transform: `translate(${pin.x}px, ${pin.y}px)` }}
					onPointerDown={(event) => event.stopPropagation()}
					onClick={() => commentFocus.set({ kind: 'thread', threadId: pin.id })}
					aria-label={`Comment by ${authorName(pin.author)}, ${pin.count} ${pin.count === 1 ? 'message' : 'messages'}`}
					data-testid="lb.comment-pin"
				>
					{initial(authorName(pin.author))}
					{pin.count > 1 && <span className="lb-comment-pin__count">{pin.count}</span>}
				</button>
			))}
			{focus?.kind === 'draft' && draftPoint && (
				<>
					<span className="lb-comment-pin lb-comment-pin--draft" style={{ transform: `translate(${draftPoint.x}px, ${draftPoint.y}px)` }}>
						+
					</span>
					<Popover x={draftPoint.x} y={draftPoint.y}>
						<Composer
							placeholder="Add a comment"
							onSend={(text) => {
								const threadId = startThread(editor, focus.anchor, focus.pageId, text)
								commentFocus.set({ kind: 'thread', threadId })
							}}
							onCancel={() => commentFocus.set(null)}
						/>
					</Popover>
				</>
			)}
			{openPin && focus?.kind === 'thread' && (
				<Popover x={openPin.x} y={openPin.y}>
					<ThreadView threadId={focus.threadId} />
				</Popover>
			)}
		</div>
	)
}

/** Beside a pin, kept on screen. */
function Popover({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
	const editor = useEditor()
	const { w, h } = useValue('lifeboard:viewport', () => editor.getViewportScreenBounds(), [editor])
	const left = Math.max(8, Math.min(x + 22, w - 320))
	const top = Math.max(8, Math.min(y - 16, h - 360))
	return (
		<div
			className="lb-comment-popover"
			style={{ left, top }}
			onPointerDown={(event) => event.stopPropagation()}
			onWheel={(event) => event.stopPropagation()}
			data-testid="lb.comment-popover"
		>
			{children}
		</div>
	)
}

export function ThreadView({ threadId }: { threadId: TLCommentThread['id'] }) {
	const editor = useEditor()
	const thread = useValue('lifeboard:thread', () => threadById(editor, threadId) ?? null, [editor, threadId])
	const comments = useValue('lifeboard:thread-comments', () => commentsOf(editor, threadId), [editor, threadId])
	const [menu, setMenu] = useState(false)
	if (!thread) return null
	const mine = thread.createdBy === commenterId()

	return (
		<div className="lb-thread">
			<header className="lb-thread__header">
				<button
					className="lb-btn lb-btn--ghost lb-btn--tiny"
					onClick={() => setResolved(editor, thread, !thread.resolved)}
					title={thread.resolved ? 'Reopen' : 'Resolve'}
				>
					{thread.resolved ? <RotateCcw size={13} /> : <Check size={13} />} {thread.resolved ? 'Reopen' : 'Resolve'}
				</button>
				<span className="lb-thread__spacer" />
				{mine && (
					<button className="lb-btn lb-btn--ghost lb-btn--tiny" onClick={() => setMenu(!menu)} aria-label="Thread options">
						<MoreHorizontal size={14} />
					</button>
				)}
				<button className="lb-btn lb-btn--ghost lb-btn--tiny" onClick={() => commentFocus.set(null)} aria-label="Close">
					<X size={14} />
				</button>
			</header>
			{menu && (
				<button className="lb-btn lb-btn--danger lb-btn--tiny lb-thread__delete" onClick={() => deleteThread(editor, thread)}>
					Delete this thread
				</button>
			)}
			{thread.resolved && (
				<p className="lb-thread__resolved">
					Resolved by {authorName(thread.resolved.by)}, {ago(thread.resolved.at)}
				</p>
			)}
			<ol className="lb-thread__comments">
				{comments.map((comment) => (
					<CommentView key={comment.id} comment={comment} />
				))}
			</ol>
			<Composer placeholder="Reply" onSend={(text) => reply(editor, thread, text)} />
		</div>
	)
}

function CommentView({ comment }: { comment: TLComment }) {
	const editor = useEditor()
	const [editing, setEditing] = useState(false)
	const mine = comment.authorId === commenterId()
	const text = richTextToPlainText(comment.body)
	return (
		<li className="lb-thread__comment" data-testid="lb.comment">
			<div className="lb-thread__meta">
				<strong>{authorName(comment.authorId)}</strong>
				<span>
					{ago(comment.createdAt)}
					{comment.editedAt ? ' · edited' : ''}
				</span>
				{mine && !editing && (
					<span className="lb-thread__own">
						<button className="lb-thread__link" onClick={() => setEditing(true)}>
							Edit
						</button>
						<button className="lb-thread__link" onClick={() => deleteComment(editor, comment)}>
							Delete
						</button>
					</span>
				)}
			</div>
			{editing ? (
				<Composer
					initial={text}
					placeholder="Edit"
					onSend={(next) => {
						editComment(editor, comment, next)
						setEditing(false)
					}}
					onCancel={() => setEditing(false)}
				/>
			) : (
				<p className="lb-thread__text">{text}</p>
			)}
		</li>
	)
}

/** A box to write in: Enter sends, Shift+Enter starts a new line, Escape gives up (or closes the thread). */
function Composer({
	initial: initialText = '',
	placeholder,
	onSend,
	onCancel,
}: {
	initial?: string
	placeholder: string
	onSend: (text: string) => void
	onCancel?: () => void
}) {
	const [text, setText] = useState(initialText)
	const box = useRef<HTMLTextAreaElement>(null)
	useEffect(() => box.current?.focus(), [])
	const send = () => {
		const trimmed = text.trim()
		if (!trimmed) return
		onSend(trimmed)
		setText('')
	}
	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		event.stopPropagation()
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault()
			send()
		} else if (event.key === 'Escape') {
			// Out of the box: what it was for is given up, or, for a reply, the thread is closed.
			event.preventDefault()
			;(onCancel ?? (() => commentFocus.set(null)))()
		}
	}
	return (
		<div className="lb-composer">
			<textarea
				ref={box}
				value={text}
				rows={Math.min(6, Math.max(1, text.split('\n').length))}
				placeholder={placeholder}
				onChange={(event) => setText(event.target.value)}
				onKeyDown={onKeyDown}
				aria-label={placeholder}
			/>
			<button className="lb-btn lb-btn--primary lb-btn--tiny" onClick={send} disabled={!text.trim()} aria-label="Send">
				<Send size={13} />
			</button>
		</div>
	)
}
