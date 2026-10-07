import { richTextToPlainText, useEditor, useValue } from '@lifeboard/canvas'
import { MessageSquarePlus, X } from 'lucide-react'
import { useState } from 'react'
import { ago, personName } from '../boardPeople'
import { commentFocus, commentsOf, commentsPanelOpen, pinPoint, threadsOf } from './comments'

/**
 * The board's comments as a list (docs/fork-parity.md S7): open threads, or resolved ones, each with
 * its first words and how many replies. Choosing one goes to its pin and opens it.
 */
export function CommentsPanel() {
	const editor = useEditor()
	const open = useValue('lifeboard:comments-panel', () => commentsPanelOpen.get(), [])
	const [showResolved, setShowResolved] = useState(false)
	const threads = useValue(
		'lifeboard:comment-list',
		() =>
			threadsOf(editor)
				.filter((thread) => Boolean(thread.resolved) === showResolved)
				.flatMap((thread) => {
					const comments = commentsOf(editor, thread.id)
					const first = comments[0]
					if (!first) return []
					return [{ thread, first, replies: comments.length - 1, latest: comments[comments.length - 1]!.createdAt }]
				})
				.sort((a, b) => b.latest - a.latest),
		[editor, showResolved]
	)
	if (!open) return null

	const go = (entry: (typeof threads)[number]) => {
		const { thread } = entry
		if (thread.pageId !== editor.getCurrentPageId()) editor.setCurrentPage(thread.pageId)
		const at = pinPoint(editor, thread.anchor)
		if (at) editor.centerOnPoint(at, { duration: 240 })
		commentFocus.set({ kind: 'thread', threadId: thread.id })
	}

	return (
		<aside className="lb-comments-panel" onPointerDown={(event) => event.stopPropagation()} data-testid="lb.comments-panel">
			<header className="lb-comments-panel__header">
				<h2>Comments</h2>
				<button
					className="lb-btn lb-btn--ghost lb-btn--tiny"
					onClick={() => commentFocus.set({ kind: 'placing' })}
					title="New comment (C)"
					aria-label="New comment"
				>
					<MessageSquarePlus size={14} />
				</button>
				<button className="lb-btn lb-btn--ghost lb-btn--tiny" onClick={() => commentsPanelOpen.set(false)} aria-label="Close comments">
					<X size={14} />
				</button>
			</header>
			<div className="lb-comments-panel__tabs" role="tablist">
				<button role="tab" aria-selected={!showResolved} onClick={() => setShowResolved(false)}>
					Open
				</button>
				<button role="tab" aria-selected={showResolved} onClick={() => setShowResolved(true)}>
					Resolved
				</button>
			</div>
			{threads.length === 0 ? (
				<p className="lb-comments-panel__empty">
					{showResolved ? 'Nothing resolved yet.' : 'No open comments. Press C, then click where one goes.'}
				</p>
			) : (
				<ul className="lb-comments-panel__list">
					{threads.map((entry) => (
						<li key={entry.thread.id}>
							<button onClick={() => go(entry)}>
								<span className="lb-comments-panel__who">
									{personName(entry.first.authorId) === 'you' ? 'You' : personName(entry.first.authorId)} · {ago(entry.latest)}
								</span>
								<span className="lb-comments-panel__text">{richTextToPlainText(entry.first.body)}</span>
								{entry.replies > 0 && (
									<span className="lb-comments-panel__replies">
										{entry.replies} {entry.replies === 1 ? 'reply' : 'replies'}
									</span>
								)}
							</button>
						</li>
					))}
				</ul>
			)}
		</aside>
	)
}
