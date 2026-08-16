import { Bot, CircleStop, History, ImageOff, PanelRightClose, Plus, Send, X } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
	deleteChat,
	getAgentStatus,
	interruptAgent,
	listChats,
	openChat,
	sendPrompt,
	subscribeToAgentStatus,
} from '../agent/bridge'
import { getChatState, subscribeToChat, type TranscriptRow } from '../agent/chat'
import {
	dataUrlFor,
	imageFilesFrom,
	prepareImage,
	MAX_IMAGES,
	type PendingImage,
} from '../agent/images'
import { AgentChats } from './AgentChats'
import { AgentSignIn } from './AgentSignIn'

/**
 * The agent panel: a conversation with Claude Code, docked to the right of the board.
 *
 * The point of it being *here* rather than in a terminal is that the board is the shared subject.
 * You watch nodes appear as they are created, on the board you are already looking at, and every one
 * of them is a normal undo step — so the panel needs no preview, no diff and no apply button. That
 * is why the transcript shows tool calls by name and not their payloads: the payload is the board.
 *
 * The panel deliberately owns no connection. It reads the same bridge Settings → Agents controls, so
 * there is exactly one switch for "something outside the browser may touch my boards", and closing
 * the panel does not cancel a turn — the store outlives it (see `chat.ts`).
 */
export function AgentPanel({ onClose }: { onClose: () => void }) {
	const status = useSyncExternalStore(subscribeToAgentStatus, getAgentStatus)
	const chat = useSyncExternalStore(subscribeToChat, getChatState)
	const [draft, setDraft] = useState('')
	const [showChats, setShowChats] = useState(false)
	const [images, setImages] = useState<PendingImage[]>([])
	const [imageNote, setImageNote] = useState('')

	/**
	 * Object URLs are a manual allocation: without this, every pasted screenshot leaks its blob for
	 * the lifetime of the tab. Revoked on unmount only — dropping one revokes it in `removeImage`.
	 */
	const imagesRef = useRef(images)
	imagesRef.current = images
	useEffect(
		() => () => {
			for (const image of imagesRef.current) URL.revokeObjectURL(image.previewUrl)
		},
		[]
	)

	const removeImage = (id: string) => {
		setImages((current) => {
			const dropped = current.find((image) => image.id === id)
			if (dropped) URL.revokeObjectURL(dropped.previewUrl)
			return current.filter((image) => image.id !== id)
		})
		setImageNote('')
	}

	/**
	 * Takes images off the clipboard.
	 *
	 * `preventDefault` only when there were images — otherwise this would swallow ordinary text
	 * pastes, which is the one thing a composer must never do.
	 */
	const onPaste = (event: React.ClipboardEvent) => {
		const files = imageFilesFrom(event.clipboardData)
		if (files.length === 0) return
		event.preventDefault()
		void addImages(files)
	}

	const addImages = async (files: readonly File[]) => {
		const room = MAX_IMAGES - imagesRef.current.length
		if (room <= 0) {
			setImageNote(`Up to ${MAX_IMAGES} images per message.`)
			return
		}

		const prepared = await Promise.all(files.slice(0, room).map(prepareImage))
		const kept = prepared.filter((image): image is PendingImage => image !== null)

		// Said out loud rather than silently dropped: an image that vanished on paste reads as the
		// paste not having worked at all.
		const refused = prepared.length - kept.length
		setImageNote(
			refused > 0
				? `${refused === 1 ? 'One image was' : `${refused} images were`} too large to send.`
				: files.length > room
					? `Only the first ${room} of ${files.length} images were added.`
					: ''
		)
		if (kept.length) setImages((current) => [...current, ...kept])
	}

	// Asked for once per connection rather than on mount: the host pushes the list when a tab
	// attaches, so this only covers a panel opened long after that.
	useEffect(() => {
		if (status.connection === 'connected' && status.chat) listChats()
	}, [status.connection, status.chat])

	const transcript = useRef<HTMLDivElement>(null)

	/**
	 * Follow the turn, unless the user has scrolled up to read.
	 *
	 * Sticking to the bottom unconditionally is the obvious version and the wrong one: a turn emits
	 * rows for many seconds, so scrolling back to re-read a tool result gets yanked to the bottom
	 * again on the next delta and the transcript becomes unreadable exactly when it is most worth
	 * reading. Tracked in a ref rather than state — it changes on every scroll event and no render
	 * depends on it.
	 */
	const pinned = useRef(true)

	useEffect(() => {
		if (pinned.current) transcript.current?.scrollTo({ top: transcript.current.scrollHeight })
	}, [chat.rows])

	/**
	 * Re-pins when the user scrolls back to the bottom themselves, which is how they say "carry on
	 * following" without a button to press. The tolerance absorbs sub-pixel scroll heights, which
	 * otherwise leave it a fraction short of the bottom and never re-pin.
	 */
	const onScroll = () => {
		const el = transcript.current
		if (!el) return
		pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
	}

	const ready = status.connection === 'connected' && status.chat && chat.auth !== 'signed-out'
	const signedOut = status.connection === 'connected' && status.chat && chat.auth === 'signed-out'

	const submit = () => {
		// Images alone are a turn: a screenshot with no words is a real question.
		//
		// Deliberately *not* blocked while busy — sending mid-turn is how you steer work already in
		// flight ("actually, group those by shop"). The message queues and the agent picks it up.
		if (!draft.trim() && images.length === 0) return
		// Sending re-pins: you always want to watch your own turn, even if you had scrolled up to
		// read the last one.
		pinned.current = true
		sendPrompt(draft, images)
		setDraft('')
		// The previews belong to the composer, and the sent row renders from the base64 it was given —
		// so the object URLs are released here rather than handed on.
		for (const image of images) URL.revokeObjectURL(image.previewUrl)
		setImages([])
		setImageNote('')
	}

	return (
		<aside className="lb-agent-panel" aria-label="Agent">
			<header className="lb-agent-panel__header">
				<span className="lb-agent-panel__title">
					<Bot size={15} aria-hidden="true" />
					Agent
				</span>
				<span className="lb-agent-panel__spacer" />
				<button
					type="button"
					className={showChats ? 'lb-agent-panel__icon lb-agent-panel__icon--active' : 'lb-agent-panel__icon'}
					onClick={() => {
						// Refreshed on open rather than polled: the list only changes when a turn ends or a
						// chat is deleted, and both are things the user just did.
						if (!showChats) listChats()
						setShowChats(!showChats)
					}}
					title="Chat history"
					aria-label="Chat history"
					aria-pressed={showChats}
				>
					<History size={14} aria-hidden="true" />
				</button>
				<button
					type="button"
					className="lb-agent-panel__icon"
					onClick={() => {
						openChat(null)
						setShowChats(false)
					}}
					title="New chat"
					aria-label="New chat"
				>
					<Plus size={15} aria-hidden="true" />
				</button>
				<button
					type="button"
					className="lb-agent-panel__icon"
					onClick={onClose}
					title="Close agent panel"
					aria-label="Close agent panel"
				>
					<PanelRightClose size={15} aria-hidden="true" />
				</button>
			</header>

			{showChats ? (
				<AgentChats
					chats={chat.chats}
					activeId={chat.activeId}
					onOpen={(sessionId) => {
						openChat(sessionId)
						setShowChats(false)
					}}
					onNew={() => {
						openChat(null)
						setShowChats(false)
					}}
					onDelete={deleteChat}
				/>
			) : (
				<div className="lb-agent-panel__transcript" ref={transcript} onScroll={onScroll}>
					{signedOut ? (
						<AgentSignIn detail={chat.authDetail} />
					) : chat.rows.length === 0 ? (
						<Empty ready={ready} status={status.connection} />
					) : (
						chat.rows.map((row) => <Row key={row.id} row={row} />)
					)}
				</div>
			)}

			<form
				className="lb-agent-panel__composer"
				onSubmit={(event) => {
					event.preventDefault()
					submit()
				}}
			>
				{images.length > 0 && (
					<ul className="lb-agent-attachments">
						{images.map((image) => (
							<li key={image.id} className="lb-agent-attachments__item">
								<img src={image.previewUrl} alt={image.name} />
								<button
									type="button"
									className="lb-agent-attachments__remove"
									onClick={() => removeImage(image.id)}
									aria-label={`Remove ${image.name}`}
									title="Remove"
								>
									<X size={11} aria-hidden="true" />
								</button>
							</li>
						))}
					</ul>
				)}
				{imageNote && (
					<p className="lb-agent-attachments__note">
						<ImageOff size={12} aria-hidden="true" />
						{imageNote}
					</p>
				)}

				<textarea
					className="lb-agent-panel__input"
					value={draft}
					rows={2}
					disabled={!ready}
					placeholder={
						!ready
							? 'Not connected to an agent host'
							: chat.busy
								? 'Send another message to steer it…'
								: 'Ask the agent, or paste an image…'
					}
					onPaste={onPaste}
					onChange={(event) => setDraft(event.target.value)}
					onKeyDown={(event) => {
						// Enter sends, Shift+Enter breaks the line: the convention every chat box in the
						// user's day already follows.
						if (event.key === 'Enter' && !event.shiftKey) {
							event.preventDefault()
							submit()
						}
					}}
				/>
				{/* Both while busy, rather than Stop *replacing* Send: the composer stays live so a
				    follow-up can steer the work, and stopping has to remain one click away. */}
				<div className="lb-agent-panel__actions">
					{chat.busy && (
						<button
							type="button"
							className="lb-agent-panel__send lb-agent-panel__send--stop"
							onClick={interruptAgent}
							title="Stop"
						>
							<CircleStop size={15} aria-hidden="true" />
							Stop
						</button>
					)}
					<button
						type="submit"
						className="lb-agent-panel__send"
						disabled={!ready || (!draft.trim() && images.length === 0)}
						title={chat.busy ? 'Send — queued for the running turn' : 'Send'}
					>
						<Send size={14} aria-hidden="true" />
						Send
					</button>
				</div>
			</form>
		</aside>
	)
}

/**
 * The empty state, which is really the setup instructions.
 *
 * Written out in full rather than pointing at the docs because this is exactly the moment somebody
 * has opened the panel to find out what it is, and "see the README" is a worse answer than four
 * lines of shell.
 */
function Empty({ ready, status }: { ready: boolean; status: string }) {
	if (ready) {
		return (
			<div className="lb-agent-panel__empty">
				<p>Ask for something and watch it happen on the board.</p>
				<ul>
					<li>“Make a board for my trip and add a note per city.”</li>
					<li>“Look up the four biggest Icelandic waterfalls and add one node each.”</li>
					<li>“Find every node with no Status and set it to Todo.”</li>
				</ul>
				<p className="lb-agent-panel__note">
					Everything it does is a normal undo step, and it can search the web but cannot touch
					your files.
				</p>
			</div>
		)
	}

	// Connected, but to the stdio relay — which has no model behind it.
	if (status === 'connected') {
		return (
			<div className="lb-agent-panel__empty">
				<p>
					The app is connected to the MCP relay, which forwards to an agent running somewhere else
					and has nothing to answer this box.
				</p>
				<p className="lb-agent-panel__note">
					Stop that server and restart the dev server, and the panel starts its own agent
					automatically.
				</p>
			</div>
		)
	}

	return (
		<div className="lb-agent-panel__empty">
			<p>Waiting for the agent host.</p>
			<p className="lb-agent-panel__note">
				The dev server starts it for you, so there is nothing to configure — if this does not
				clear in a moment, restart the dev server and check its output. It signs in with your
				existing Claude Code login.
			</p>
		</div>
	)
}

function Row({ row }: { row: TranscriptRow }) {
	switch (row.kind) {
		case 'user':
			return (
				<div className="lb-agent-row lb-agent-row--user">
					{row.images?.length ? (
						<div className="lb-agent-row__images">
							{row.images.map((image, index) => (
								<img
									key={index}
									src={dataUrlFor(image)}
									alt={`Attached image ${index + 1}`}
								/>
							))}
						</div>
					) : null}
					{row.text}
				</div>
			)
		case 'agent':
			return (
				<div className="lb-agent-row lb-agent-row--agent" data-streaming={row.streaming || undefined}>
					{row.text}
				</div>
			)
		case 'status':
			return <div className="lb-agent-row lb-agent-row--status">{row.text}</div>
		case 'error':
			return <div className="lb-agent-row lb-agent-row--error">{row.text}</div>
		case 'tool':
			return (
				<div className="lb-agent-row lb-agent-row--tool" data-state={row.state}>
					<span className="lb-agent-row__tool-name">{prettyToolName(row.name)}</span>
					{row.summary && <span className="lb-agent-row__tool-summary">{row.summary}</span>}
				</div>
			)
	}
}

/**
 * A tool name as the user should read it.
 *
 * The wire carries `mcp__lifeboard__node_insert`, which is three encodings deep — the SDK's MCP
 * namespacing, the underscore-for-dot swap MCP tool names require, and the operation id itself.
 * Undoing all three here keeps that entirely inside the plumbing that needs it.
 */
export function prettyToolName(name: string): string {
	const bare = name.startsWith('mcp__lifeboard__') ? name.slice('mcp__lifeboard__'.length) : name
	return bare.replace(/_/g, '.')
}
