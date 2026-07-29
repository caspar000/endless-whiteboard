import { createNodeShapeUtil, getNodeDefinitions, rollupStats } from '@lifeboard/node-kit'
import { useEffect, useMemo, useState } from 'react'
import {
	Tldraw,
	type Editor,
	type TLAnyShapeUtilConstructor,
	type TLComponents,
	type TldrawOptions,
	type TLEventInfo,
} from 'tldraw'
import 'tldraw/tldraw.css'
import { touchBoard, type BoardMeta } from '../boards/boardIndex'
import { seedDemoBoard } from '../boards/demoBoard'
import { usePlatform } from '../platform/PlatformContext'
import { createLifeboardAssetStore } from '../persistence/assetStore'
import { saveBoardThumbnail } from '../persistence/thumbnails'
import { MAX_IMPORT_BYTES } from '../persistence/downscale'
import { clearPendingRestore, takePendingRestore } from '../persistence/pendingRestore'
import { persistenceKeyForBoard, type RawBoardSnapshot } from '../persistence/tldrawLocalDb'
import { DottedPaper } from './DottedPaper'
import { NodeCreateMenu, type NodeCreatePrompt } from './NodeCreateMenu'
import { createNodeTools } from './nodeTools'
import { nodeComponents, nodeUiOverrides } from './uiOverrides'
import { RollupDebugBadge } from './RollupDebugBadge'

/**
 * The canvas. `persistenceKey` gives us tldraw's built-in IndexedDB persistence — throttled writes,
 * cross-tab BroadcastChannel sync, and automatic schema migration on load — with no pipeline of our
 * own (§4.4). `key={boardId}` forces a clean remount when switching boards, so no state leaks
 * between them.
 */

// Built once at module scope: rebuilding shape utils on every render would recreate every shape's
// class identity and defeat tldraw's caching. Both lists come from the same registry, so a node
// type can never end up with a shape util but no tool (or vice versa) — node-kit registers its
// built-ins during its own module evaluation, which ESM guarantees happens before this line.
const nodeShapeUtils: TLAnyShapeUtilConstructor[] = getNodeDefinitions().map(createNodeShapeUtil)
const nodeTools = createNodeTools()

const canvasComponents: TLComponents = {
	...nodeComponents,
	// The dotted-paper backdrop (see DottedPaper.tsx).
	Background: DottedPaper,
	// The colour/opacity panel in the top-right is removed: none of the node types have style props,
	// so for the shapes this app is *about* the panel was always inert.
	StylePanel: null,
}

/** Longest we'll make someone wait for a preview before leaving anyway. */
const THUMBNAIL_TIMEOUT_MS = 2_000

const editorOptions: Partial<TldrawOptions> = {
	createTextOnCanvasDoubleClick: false,
}

/**
 * Turns a double-click on empty canvas into a request to open the node picker.
 *
 * Listens on `'event'` rather than subclassing the select tool: the behaviour we're replacing is
 * already gated behind `createTextOnCanvasDoubleClick`, so with that off the default does nothing and
 * this simply adds ours. `'settle-up'` is the phase after tldraw has decided the gesture really was a
 * double-click and not the start of a triple.
 */
function watchCanvasDoubleClicks(
	editor: Editor,
	onPrompt: (prompt: NodeCreatePrompt) => void
): () => void {
	// `editor.on` returns the editor for chaining, not an unsubscribe, so the handler is kept and
	// removed explicitly.
	const handler = (info: TLEventInfo) => {
		if (info.type !== 'click' || info.name !== 'double_click') return
		if (info.phase !== 'settle-up' || info.target !== 'canvas') return
		// Don't offer to create a node on top of an existing one.
		if (editor.getShapeAtPoint(editor.inputs.getCurrentPagePoint(), { hitInside: true })) return

		const page = editor.inputs.getCurrentPagePoint()
		onPrompt({
			page: { x: page.x, y: page.y },
			screen: { x: info.point.x, y: info.point.y },
		})
	}
	editor.on('event', handler)
	return () => editor.off('event', handler)
}

// The rollup recompute counters, so the perf suite can assert the §4.3 guarantee ("zero rollup
// recomputes while dragging") against real numbers rather than wall-clock timing, which varies by
// machine. Exposed at module scope, not per mount: `rollupStats` is a singleton, and tying it to a
// mount meant a *draining* board's unmount deleted the live board's counters.
;(window as unknown as { __rollupStats?: typeof rollupStats }).__rollupStats = rollupStats

export function Board({
	board,
	seedDemo = false,
	onExit,
	onRename,
}: {
	board: BoardMeta
	seedDemo?: boolean
	onExit: () => void
	onRename?: (name: string) => void
}) {
	const platform = usePlatform()
	const [restore, setRestore] = useState<{ ready: boolean; snapshot?: RawBoardSnapshot }>({
		ready: false,
	})

	// An imported board carries its snapshot in KV until first open; handing it to <Tldraw> is what
	// makes tldraw run migrations on it (see persistence/pendingRestore.ts).
	useEffect(() => {
		let cancelled = false
		void takePendingRestore(platform.kv, board.id).then((snapshot) => {
			if (!cancelled) setRestore({ ready: true, ...(snapshot ? { snapshot } : {}) })
		})
		return () => {
			cancelled = true
		}
	}, [platform, board.id])

	const assets = useMemo(() => createLifeboardAssetStore(platform.blobs), [platform])

	// The node picker shown on double-clicking empty canvas (see NodeCreateMenu).
	const [createPrompt, setCreatePrompt] = useState<NodeCreatePrompt | null>(null)
	const [editor, setEditor] = useState<Editor | null>(null)
	const [leaving, setLeaving] = useState(false)

	/**
	 * Capture the home-screen thumbnail, then leave.
	 *
	 * Awaited on purpose: the export has to finish while the board is still mounted *and visible*, so
	 * it cannot be fired off into the navigation. It takes a fraction of a second, and the button
	 * shows that it is working.
	 */
	const leave = async () => {
		if (leaving) return
		setLeaving(true)
		if (editor) {
			// Bounded: leaving a board must never be blocked by a thumbnail. `saveBoardThumbnail`
			// swallows its own errors, but a hung export would otherwise strand the user on "Saving…".
			await Promise.race([
				saveBoardThumbnail(platform.kv, board.id, editor),
				new Promise((resolve) => setTimeout(resolve, THUMBNAIL_TIMEOUT_MS)),
			])
		}
		onExit()
		// Cleared because the flag only covers the await above. This component is normally about to
		// unmount — but not always: reopening the board while it is still draining reuses this very
		// instance, and a stale `true` left the back button reading "Saving…" and refusing to leave.
		setLeaving(false)
	}

	if (!restore.ready) return <div className="lb-board__loading">Opening board…</div>

	return (
		<div className="lb-board">
			<Tldraw
				key={board.id}
				persistenceKey={persistenceKeyForBoard(board.id)}
				{...(restore.snapshot ? { snapshot: restore.snapshot as never } : {})}
				shapeUtils={nodeShapeUtils}
				tools={nodeTools}
				overrides={nodeUiOverrides}
				components={canvasComponents}
				// Double-clicking empty canvas asks which kind of node to create instead of silently
				// making a text shape — in an app about typed nodes, the untyped one is a poor default.
				options={editorOptions}
				// The app chrome and every node component are dark (styles.css). Letting tldraw follow
				// the OS instead put a light canvas and light toolbar around dark node cards. A light
				// theme is a reasonable follow-up, but it means restyling the nodes too, not just
				// flipping this flag.
				colorScheme="dark"
				assets={assets}
				maxAssetSize={MAX_IMPORT_BYTES}
				onMount={(editor) => {
					// The pending snapshot has now been loaded and is being persisted by tldraw, so
					// drop it — otherwise reopening the board would replay the import.
					if (restore.snapshot) void clearPendingRestore(platform.kv, board.id)
					// Seed only a genuinely empty board: the demo route can be revisited (reload,
					// back button) and must not duplicate the demo content.
					if (seedDemo && editor.getCurrentPageShapeIds().size === 0) seedDemoBoard(editor)

					// Debug/test seam: lets the e2e suite assert on real store state instead of
					// scraping the DOM, and makes the console usable when diagnosing a board.
					// Cleared on unmount — leaving a disposed editor here is worse than leaving
					// nothing, because writes to it are silently dropped.
					const w = window as unknown as { editor?: Editor }
					w.editor = editor
					setEditor(editor)

					const stopTracking = trackBoardActivity(editor, () =>
						void touchBoard(platform.kv, board.id)
					)
					const stopWatchingDoubleClicks = watchCanvasDoubleClicks(editor, setCreatePrompt)

					return () => {
						// Guarded: while a board is draining (see DRAIN_MS in app/App.tsx) its editor
						// unmounts *after* the next one has mounted, so an unguarded delete here would
						// wipe the live editor's handle.
						if (w.editor === editor) delete w.editor
						stopWatchingDoubleClicks()
						stopTracking()
						// NB: no thumbnail capture here. Exporting from the unmount path ran while the
						// board host was already hidden for the drain, and tldraw's exporter dropped every
						// node background and font — previews looked right for a second and then decayed
						// into serif text. It happens in `leave()` below, while the board is still visible.
					}
				}}
			>
				{/* Children of <Tldraw> render *inside* the editor context, so they may call
				    `useEditor`. The debug badge does — rendering it as a sibling threw
				    "useEditor must be used inside of <Tldraw />" and took the whole app down in
				    dev, where the badge is the only thing that renders it. */}
				{import.meta.env.DEV && <RollupDebugBadge />}
			</Tldraw>
			<BoardChrome board={board} onExit={() => void leave()} leaving={leaving} onRename={onRename} />
			{editor && createPrompt && (
				<NodeCreateMenu
					editor={editor}
					prompt={createPrompt}
					onClose={() => setCreatePrompt(null)}
				/>
			)}
		</div>
	)
}

/**
 * Keeps the board index's `updatedAt` fresh without writing on every keystroke: the store fires
 * constantly while drawing, so writes are coalesced to at most one per interval.
 */
function trackBoardActivity(editor: Editor, touch: () => void): () => void {
	const INTERVAL = 30_000
	let last = 0
	const unlisten = editor.store.listen(
		() => {
			const now = Date.now()
			if (now - last < INTERVAL) return
			last = now
			touch()
		},
		{ scope: 'document', source: 'user' }
	)
	return () => {
		unlisten()
		touch()
	}
}

function BoardChrome({
	board,
	onExit,
	leaving,
	onRename,
}: {
	board: BoardMeta
	onExit: () => void
	leaving: boolean
	onRename?: (name: string) => void
}) {
	const [renaming, setRenaming] = useState(false)

	return (
		<div className="lb-board__chrome">
			<button className="lb-board__back" onClick={onExit} title="Back to all boards">
				{leaving ? '← Saving…' : '← Boards'}
			</button>

			{renaming && onRename ? (
				<form
					className="lb-board__rename"
					onSubmit={(e) => {
						e.preventDefault()
						const value = new FormData(e.currentTarget).get('name')
						if (typeof value === 'string' && value.trim()) onRename(value.trim())
						setRenaming(false)
					}}
				>
					{/* eslint-disable-next-line jsx-a11y/no-autofocus */}
					<input
						autoFocus
						name="name"
						defaultValue={board.name}
						aria-label="Board name"
						onBlur={() => setRenaming(false)}
						onKeyDown={(e) => {
							if (e.key === 'Escape') setRenaming(false)
							// Otherwise the canvas would read these as tool shortcuts.
							e.stopPropagation()
						}}
					/>
				</form>
			) : (
				<button
					className="lb-board__name"
					// Double-click to rename, matching how the board name behaves on the home screen.
					onDoubleClick={() => onRename && setRenaming(true)}
					title={onRename ? 'Double-click to rename' : board.name}
				>
					{board.name}
				</button>
			)}
		</div>
	)
}
