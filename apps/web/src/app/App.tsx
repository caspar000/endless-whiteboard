import { useCallback, useEffect, useRef, useState } from 'react'
import { markDemoSeeded, wasDemoSeeded, type BoardMeta } from '../boards/boardIndex'
import { Board } from '../canvas/Board'
import { assetUploadActivityAt } from '../persistence/assetStore'
import { TLDRAW_PERSIST_THROTTLE_MS } from '../persistence/tldrawLocalDb'
import { usePlatform } from '../platform/PlatformContext'
import { BoardList } from './BoardList'
import { startDrain } from './drainSchedule'
import { useBoards } from './useBoards'
import { useHashRoute } from './useHashRoute'

/**
 * How long the leaving board's editor stays mounted after navigating back to the list.
 *
 * This is not cosmetic. tldraw writes to IndexedDB on a throttle, and `doPersist()` bails out if the
 * sync client has been disposed — so unmounting the editor within the throttle window **discards the
 * pending write permanently**. Drawing a shape and immediately clicking "← Boards" lost the shape;
 * the first-run demo board lost all of its content the same way.
 *
 * So on exit the board list renders immediately while the editor stays mounted but hidden, just long
 * enough for its queued write to land, and only then unmounts.
 */
const DRAIN_MS = TLDRAW_PERSIST_THROTTLE_MS + 400

/**
 * Upper bound on a drain extended by a running image upload (see `drainSchedule.ts`), so a wedged
 * upload can't pin a hidden editor for the rest of the session. Past the cap the asset stays
 * half-written, which asset GC and backup export both detect and refuse to act on.
 */
const MAX_DRAIN_MS = 15_000

export function App() {
	const platform = usePlatform()
	const api = useBoards()
	const [route, navigate] = useHashRoute()
	const [seeding, setSeeding] = useState(false)

	/** A board being kept mounted purely to let its pending write flush. */
	const [draining, setDraining] = useState<BoardMeta | null>(null)
	const cancelDrain = useRef<(() => void) | null>(null)

	// Ask for durable storage once, at startup. Chrome grants it silently based on engagement;
	// Safari grants it to installed PWAs. Either way, asking early is free (§4.4).
	useEffect(() => {
		void platform.requestPersistentStorage()
	}, [platform])

	useEffect(() => {
		return () => cancelDrain.current?.()
	}, [])

	// First run with no boards at all → seed the demo board so the app explains itself.
	//
	// Guarded by a ref rather than by effect cleanup: seeding creates a board and then navigates,
	// and a cleanup-based cancellation would abort that sequence halfway the moment any unrelated
	// re-render happened, leaving a created-but-never-opened board behind.
	const seedAttempted = useRef(false)
	useEffect(() => {
		if (api.loading || seedAttempted.current) return
		if (api.boards.length > 0) return
		seedAttempted.current = true
		void (async () => {
			// Persisted so that deleting the demo board doesn't cause it to reappear on next launch.
			if (await wasDemoSeeded(platform.kv)) return
			setSeeding(true)
			try {
				await markDemoSeeded(platform.kv)
				const board = await api.create('Home office shopping')
				navigate({ view: 'board', boardId: board.id, seedDemo: true })
			} finally {
				setSeeding(false)
			}
		})()
	}, [api, platform, navigate])

	// Reopening a board while it is still draining means the user is not leaving after all, so stop the
	// countdown — otherwise its timer fires mid-session and unmounts the editor they just came back to.
	useEffect(() => {
		if (route.view !== 'board' || draining?.id !== route.boardId) return
		cancelDrain.current?.()
		cancelDrain.current = null
		setDraining(null)
	}, [route, draining])

	const exitToList = useCallback(
		(board: BoardMeta) => {
			setDraining(board)
			cancelDrain.current?.()
			cancelDrain.current = startDrain({
				drainMs: DRAIN_MS,
				maxMs: MAX_DRAIN_MS,
				lastActivityAt: assetUploadActivityAt,
				onDone: () => {
					cancelDrain.current = null
					setDraining(null)
				},
			})

			navigate({ view: 'list' })
			void api.refresh()
		},
		[navigate, api]
	)

	/**
	 * Deleting a board that is still draining would block its own delete: the mounted editor holds
	 * an open connection to that database, so `deleteDatabase` never completes. Cancelling the drain
	 * first is safe precisely because we are about to throw the data away.
	 */
	const removeBoard = useCallback(
		async (id: string) => {
			if (draining?.id === id) {
				cancelDrain.current?.()
				cancelDrain.current = null
				setDraining(null)
				// Give React a frame to commit the unmount so tldraw closes its connection.
				await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
			}
			await api.remove(id)
		},
		[draining, api]
	)

	const listApi = { ...api, remove: removeBoard }

	const routedBoard =
		route.view === 'board' ? api.boards.find((b) => b.id === route.boardId) : undefined

	if (route.view === 'board' && !api.loading && !routedBoard) {
		// A stale hash (deleted board, or an old link) should land somewhere useful, not a blank page.
		return (
			<div className="lb-list__empty">
				<p>That board no longer exists.</p>
				<button className="lb-btn" onClick={() => navigate({ view: 'list' })}>
					Back to all boards
				</button>
			</div>
		)
	}

	// The board being *rendered* is not always the routed one: while draining, the editor for the
	// board we just left stays mounted. Keeping it in the same tree position with the same key is
	// what preserves the editor instance — remounting it would create a fresh sync client and the
	// pending write would already be gone.
	const mountedBoard = routedBoard ?? draining
	const isDraining = route.view !== 'board' && mountedBoard !== undefined

	if (route.view === 'board' && api.loading) {
		return <div className="lb-board__loading">Loading…</div>
	}

	return (
		<>
			{mountedBoard && (
				<div className="lb-board-host" {...(isDraining ? { 'data-draining': 'true' } : {})}>
					<Board
						key={mountedBoard.id}
						board={mountedBoard}
						seedDemo={route.view === 'board' && route.seedDemo === true}
						onExit={() => exitToList(mountedBoard)}
						onRename={(name) => void api.rename(mountedBoard.id, name)}
					/>
				</div>
			)}

			{route.view === 'list' &&
				(seeding ? (
					// Without this, first run would flash the "No boards yet" empty state between the
					// index loading and the demo board being created.
					<div className="lb-board__loading">Setting up your first board…</div>
				) : (
					<BoardList
						api={listApi}
						onOpen={(board) => navigate({ view: 'board', boardId: board.id })}
					/>
				))}
		</>
	)
}
