import { createNodeShapeUtil, getNodeDefinitions, rollupStats } from '@lifeboard/node-kit'
import { useEffect, useMemo, useState } from 'react'
import { Tldraw, type Editor, type TLAnyShapeUtilConstructor } from 'tldraw'
import 'tldraw/tldraw.css'
import { touchBoard, type BoardMeta } from '../boards/boardIndex'
import { seedDemoBoard } from '../boards/demoBoard'
import { usePlatform } from '../platform/PlatformContext'
import { createLifeboardAssetStore } from '../persistence/assetStore'
import { MAX_IMPORT_BYTES } from '../persistence/downscale'
import { clearPendingRestore, takePendingRestore } from '../persistence/pendingRestore'
import { persistenceKeyForBoard, type RawBoardSnapshot } from '../persistence/tldrawLocalDb'
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

// The rollup recompute counters, so the perf suite can assert the §4.3 guarantee ("zero rollup
// recomputes while dragging") against real numbers rather than wall-clock timing, which varies by
// machine. Exposed at module scope, not per mount: `rollupStats` is a singleton, and tying it to a
// mount meant a *draining* board's unmount deleted the live board's counters.
;(window as unknown as { __rollupStats?: typeof rollupStats }).__rollupStats = rollupStats

export function Board({
	board,
	seedDemo = false,
	onExit,
}: {
	board: BoardMeta
	seedDemo?: boolean
	onExit: () => void
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
				components={nodeComponents}
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

					const stopTracking = trackBoardActivity(editor, () =>
						void touchBoard(platform.kv, board.id)
					)
					return () => {
						// Guarded: while a board is draining (see DRAIN_MS in app/App.tsx) its editor
						// unmounts *after* the next one has mounted, so an unguarded delete here would
						// wipe the live editor's handle.
						if (w.editor === editor) delete w.editor
						stopTracking()
					}
				}}
			>
				{/* Children of <Tldraw> render *inside* the editor context, so they may call
				    `useEditor`. The debug badge does — rendering it as a sibling threw
				    "useEditor must be used inside of <Tldraw />" and took the whole app down in
				    dev, where the badge is the only thing that renders it. */}
				{import.meta.env.DEV && <RollupDebugBadge />}
			</Tldraw>
			<BoardChrome board={board} onExit={onExit} />
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

function BoardChrome({ board, onExit }: { board: BoardMeta; onExit: () => void }) {
	return (
		<div className="lb-board__chrome">
			<button className="lb-board__back" onClick={onExit} title="Back to all boards">
				← Boards
			</button>
			<span className="lb-board__name">{board.name}</span>
		</div>
	)
}
