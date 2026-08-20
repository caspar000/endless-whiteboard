import {
	ArrowUp,
	Bot,
	ChevronDown,
	ChevronRight,
	CircleStop,
	History,
	ImageOff,
	Plus,
	X,
} from 'lucide-react'
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
import { getChatState, subscribeToChat } from '../agent/chat'
import { toDisplayItems, type DisplayItem } from '../agent/transcript'
import {
	dataUrlFor,
	imageFilesFrom,
	prepareImage,
	MAX_IMAGES,
	type PendingImage,
} from '../agent/images'
import { formatToolInput, prettyToolName } from '../agent/toolRow'
import { AgentChats } from './AgentChats'
import { AgentContextChip } from './AgentContextChip'
import { AgentContextMeter } from './AgentContextMeter'
import { AgentMarkdown, CopyButton } from './AgentMarkdown'
import { AgentMinimap, type MinimapMark } from './AgentMinimap'
import { AgentModelControls } from './AgentModelControls'
import { AgentResizeDivider, type AgentDivider } from './agentPanelWidth'
import { AgentSignIn } from './AgentSignIn'
import { AgentUserMessage } from './AgentUserMessage'
import { AgentFoldRow, AgentWorkingRow } from './AgentWorking'
import { AgentWorkGroup, WorkRow } from './AgentWorkGroup'

/**
 * The agent panel: a conversation with Claude Code, docked to the right of the board.
 *
 * The point of it being *here* rather than in a terminal is that the board is the shared subject.
 * You watch nodes appear as they are created, on the board you are already looking at, and every one
 * of them is a normal undo step — so the panel needs no preview, no diff and no apply button. That
 * is why the transcript shows tool calls by name and keeps their payloads closed: the payload is the
 * board, and the JSON is there only for the turn that went somewhere you did not follow.
 *
 * The panel deliberately owns no connection. It reads the same bridge Settings → Agents controls, so
 * there is exactly one switch for "something outside the browser may touch my boards", and closing
 * the panel does not cancel a turn — the store outlives it (see `chat.ts`).
 *
 * It has no close button of its own either. There is one control for showing and hiding it — the
 * toggle at the right of the tab strip — and it lives where you go to *open* the panel, so opening
 * and closing are the same gesture in the same place rather than two buttons that do one thing.
 * The header keeps only what acts on the conversation: its history, and a new one.
 */
export function AgentPanel({ divider }: { divider: AgentDivider }) {
	const status = useSyncExternalStore(subscribeToAgentStatus, getAgentStatus)
	const chat = useSyncExternalStore(subscribeToChat, getChatState)
	const [draft, setDraft] = useState('')
	const [showChats, setShowChats] = useState(false)
	const [images, setImages] = useState<PendingImage[]>([])
	const [imageNote, setImageNote] = useState('')
	/**
	 * Turns whose fold the user has opened.
	 *
	 * Held here rather than per row because a fold row is recomputed on every derivation — it comes from
	 * the store, not from it — so its open state has to live above it or it would reset on each streamed
	 * delta.
	 */
	const [expandedFolds, setExpandedFolds] = useState<ReadonlySet<number>>(() => new Set())
	const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null)

	const toggleFold = (turn: number) => {
		setExpandedFolds((current) => {
			const next = new Set(current)
			if (!next.delete(turn)) next.add(turn)
			return next
		})
	}

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

	// Derived on render rather than stored: the same rows read differently once their turn has ended,
	// and grouping inside the store would mean rewriting history as it settles.
	const items = toDisplayItems({ rows: chat.rows, turns: chat.turns, expanded: expandedFolds })

	/** One minimap tick per question asked — the landmark you actually look for. */
	const marks: MinimapMark[] = chat.rows
		.filter((row): row is Extract<typeof row, { kind: 'user' }> => row.kind === 'user')
		.map((row) => ({
			id: row.id,
			label: row.text.trim().slice(0, 90) || 'Image',
		}))

	/**
	 * Scrolls a message to the top of the transcript.
	 *
	 * `scrollTo` on the container rather than `scrollIntoView` on the row: the latter also scrolls every
	 * *ancestor*, which on a board means panning the canvas behind the panel.
	 *
	 * Measured from bounding rects rather than `offsetTop`, which is relative to whichever ancestor
	 * happens to be positioned — that is the scroller, not the transcript, and a layout change to either
	 * would silently move the target. Rects are scroll-aware and mean the same thing whatever the
	 * offset parent is.
	 */
	const jumpTo = (id: string) => {
		const container = transcript.current
		const target = container?.querySelector<HTMLElement>(`[data-row-id="${id}"]`)
		if (!container || !target) return
		// Jumping is reading, not following: the turn must not yank the view back down afterwards.
		pinned.current = false
		const delta = target.getBoundingClientRect().top - container.getBoundingClientRect().top
		container.scrollTo({ top: container.scrollTop + delta - 8, behavior: 'smooth' })
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
			<AgentResizeDivider {...divider} />
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
				/*
				 * The rail is a sibling of the scroller, not a child of it.
				 *
				 * Inside the transcript it would be a flex item — `float` does not apply to those — so it
				 * took a 240px slot in the column and pushed every message down past it. And it cannot be
				 * `position: absolute` in there either: absolute children of a scroll container scroll with
				 * the content, and a minimap that scrolls away is not a map. So the scroller is a
				 * positioned wrapper and the rail hangs off that.
				 *
				 * It hangs off the *left*, in the 12px the transcript reserves there. On the right it shared
				 * an edge with the scrollbar and with every reply's copy button, which is a lot of small
				 * targets in one strip; on the left it has that edge to itself.
				 */
				<div className="lb-agent-panel__scroller">
				<div
					className="lb-agent-panel__transcript"
					ref={transcript}
					onScroll={onScroll}
					// Focusable so the transcript answers PageUp/PageDown and Home/End natively — a scroll
					// region nobody can focus is one a keyboard cannot read.
					tabIndex={0}
					aria-label="Transcript"
				>
					{signedOut ? (
						<AgentSignIn detail={chat.authDetail} />
					) : chat.rows.length === 0 ? (
						<Empty ready={ready} status={status.connection} />
					) : (
						items.map((item) => (
							<Item
								key={item.kind === 'row' ? item.row.id : `${item.kind}-${item.turn}`}
								item={item}
								rowId={item.kind === 'row' ? item.row.id : null}
								expanded={expandedFolds}
								onToggleFold={toggleFold}
								onExpandImage={(src, alt) => setLightbox({ src, alt })}
							/>
						))
					)}
				</div>
				<AgentMinimap marks={marks} onSelect={jumpTo} />
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

				{/* Above the box rather than inside it: this is a statement about what will be sent, not a
				    control that shapes the message, and it comes and goes as the user clicks around the
				    board — inside the composer it would make the whole thing jump. */}
				<AgentContextChip />

				{/* One bordered box holding the box you type in and the dials that decide what typing in
				    it costs — T3 Code's arrangement, and the reason the model and effort menus are
				    legible at all: sitting inside the composer they read as part of the request rather
				    than as app chrome that happens to be nearby. */}
				<div className="lb-agent-composer" data-disabled={!ready || undefined}>
					{/* `rows={1}` with the floor in CSS: `field-sizing: content` sizes the box to its text and
					    treats `rows` as the smallest it will shrink to, so a 2-row floor here would leave a
					    blank line under a one-line draft. */}
					<textarea
						className="lb-agent-panel__input"
						value={draft}
						rows={1}
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
					{/* Stop sits *beside* Send while busy rather than replacing it: the composer stays live
					    so a follow-up can steer the work, and stopping has to remain one click away. */}
					<div className="lb-agent-panel__actions">
						<AgentModelControls disabled={!ready} />
						<span className="lb-agent-panel__spacer" />
						{/* Only once a turn has reported. Before that there is nothing to be a fraction of. */}
						{chat.context && <AgentContextMeter usage={chat.context} />}
						{chat.busy && (
							<button
								type="button"
								className="lb-agent-panel__send lb-agent-panel__send--stop"
								onClick={interruptAgent}
								title="Stop"
								aria-label="Stop"
							>
								<CircleStop size={14} aria-hidden="true" />
							</button>
						)}
						<button
							type="submit"
							className="lb-agent-panel__send"
							disabled={!ready || (!draft.trim() && images.length === 0)}
							title={chat.busy ? 'Send — queued for the running turn' : 'Send'}
							aria-label="Send"
						>
							<ArrowUp size={15} strokeWidth={2.5} aria-hidden="true" />
						</button>
					</div>
				</div>
			</form>
			{lightbox && <ImageLightbox image={lightbox} onClose={() => setLightbox(null)} />}
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

/**
 * One thing in the transcript.
 *
 * The transcript is no longer one row per event: `toDisplayItems` groups runs of tool calls, drops the
 * repeated `Thinking…` noise, adds a live indicator to the running turn and folds the settled ones.
 * This renders whatever came out of that.
 */
function Item({
	item,
	rowId,
	expanded,
	onToggleFold,
	onExpandImage,
}: {
	item: DisplayItem
	/** Stamped on the element so the minimap can scroll to it. Only rows are landmarks. */
	rowId: string | null
	expanded: ReadonlySet<number>
	onToggleFold: (turn: number) => void
	onExpandImage: (dataUrl: string, alt: string) => void
}) {
	switch (item.kind) {
		case 'work':
			return <AgentWorkGroup tools={item.tools} />
		case 'working':
			return <AgentWorkingRow startedAt={item.startedAt} step={item.step} />
		case 'fold':
			return (
				<AgentFoldRow
					label={item.label}
					count={item.hidden.length}
					open={expanded.has(item.turn)}
					onToggle={() => onToggleFold(item.turn)}
				/>
			)
		case 'row':
			break
	}

	const row = item.row
	switch (row.kind) {
		case 'user':
			return (
				<div data-row-id={rowId ?? undefined}>
					<AgentUserMessage row={row} onExpandImage={onExpandImage} />
				</div>
			)
		case 'agent':
			return (
				<div className="lb-agent-row lb-agent-row--agent" data-streaming={row.streaming || undefined}>
					<AgentMarkdown text={row.text} />
					{/* Only once the block has closed. A copy button on a half-written answer copies half an
					    answer, and it would move under the pointer on the next delta. */}
					{!row.streaming && <CopyButton text={row.text} label="Copy reply" className="lb-agent-row__copy" />}
				</div>
			)
		case 'status':
			// Only the statuses that survived `isNoiseStatus` reach here — a real event, not "Thinking…".
			return <div className="lb-agent-row lb-agent-row--status">{row.text}</div>
		case 'error':
			return <div className="lb-agent-row lb-agent-row--error">{row.text}</div>
		case 'tool':
			// A lone call outside a group, which `toDisplayItems` does not produce today — kept so a
			// future single-tool item renders rather than vanishing.
			return <WorkRow tool={row} />
	}
}

/** A pasted screenshot, full size. Closed by clicking anywhere or pressing Escape. */
function ImageLightbox({
	image,
	onClose,
}: {
	image: { src: string; alt: string }
	onClose: () => void
}) {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onClose()
		}
		document.addEventListener('keydown', onKeyDown)
		return () => document.removeEventListener('keydown', onKeyDown)
	}, [onClose])

	return (
		<div
			className="lb-agent-lightbox"
			role="dialog"
			aria-modal="true"
			aria-label={image.alt}
			onClick={onClose}
		>
			<img src={image.src} alt={image.alt} />
		</div>
	)
}
