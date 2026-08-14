import { useCallback, useEffect, useRef, useState } from 'react'
import type { CommandContext } from '@lifeboard/node-kit'
import type { Editor } from 'tldraw'
import { markDemoSeeded, wasDemoSeeded, type BoardMeta } from '../boards/boardIndex'
import { Board } from '../canvas/Board'
import { assetUploadActivityAt } from '../persistence/assetStore'
import { clearThumbnailsExcept, saveBoardThumbnail } from '../persistence/thumbnails'
import { TLDRAW_PERSIST_THROTTLE_MS } from '../persistence/tldrawLocalDb'
import { usePlatform } from '../platform/PlatformContext'
import { setAppCommandApi } from './appCommands'
import { AppearancePanel } from './AppearancePanel'
import { BoardList } from './BoardList'
import { CommandPalette } from './CommandPalette'
import { ExtensionsPanel } from './ExtensionsPanel'
import { CanvasPrefsProvider, useCanvasPrefsState } from './canvasPrefs'
import { HelpPage } from './help/HelpPage'
import { SettingsPanel } from './SettingsPanel'
import { Sidebar } from './Sidebar'
import { TabStrip } from './TabStrip'
import { startDrain } from './drainSchedule'
import { useBoards } from './useBoards'
import { useHashRoute } from './useHashRoute'
import { useTabs } from './useTabs'
import { useRates } from './useRates'
import { useTheme } from './useTheme'

/**
 * How long a closed tab's editor stays mounted after the tab goes away.
 *
 * This is not cosmetic. tldraw writes to IndexedDB on a throttle, and `doPersist()` bails out if the
 * sync client has been disposed — so unmounting the editor within the throttle window **discards the
 * pending write permanently**. Boards whose tab is still open never unmount at all (that is what
 * makes tab switching instant *and* safe); the drain only exists for the moment a tab is closed.
 */
const DRAIN_MS = TLDRAW_PERSIST_THROTTLE_MS + 400

/**
 * Upper bound on a drain extended by a running image upload (see `drainSchedule.ts`), so a wedged
 * upload can't pin a hidden editor for the rest of the session. Past the cap the asset stays
 * half-written, which asset GC and backup export both detect and refuse to act on.
 */
const MAX_DRAIN_MS = 15_000

/** Longest we'll make someone wait for a home-screen preview before switching away anyway. */
const THUMBNAIL_TIMEOUT_MS = 2_000

const SIDEBAR_COLLAPSED_KEY = 'lifeboard:sidebar:collapsed'

function loadSidebarCollapsed(): boolean {
	try {
		const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY)
		if (stored !== null) return stored === 'true'
	} catch {
		// Use the viewport default when storage is unavailable.
	}
	return window.matchMedia('(max-width: 720px)').matches
}

/**
 * The app shell — Affine's layout: a persistent sidebar on the left, a strip of tabs across the
 * top (a pinned "All boards" tab plus one tab per open board), and the content underneath.
 */
export function App() {
	const platform = usePlatform()
	const api = useBoards()
	const [route, navigate] = useHashRoute()
	const { tabs, openTab, closeTab } = useTabs(api.boards, api.loading)
	const [seeding, setSeeding] = useState(false)
	const [paletteOpen, setPaletteOpen] = useState(false)
	const [sidebarCollapsed, setSidebarCollapsed] = useState(loadSidebarCollapsed)

	const updateSidebarCollapsed = useCallback((collapsed: boolean) => {
		setSidebarCollapsed(collapsed)
		try {
			localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed))
		} catch {
			// The rail still works for this session when private storage rejects the write.
		}
	}, [])

	/** Boards kept mounted purely to let a closed tab's pending write flush. */
	const [draining, setDraining] = useState<BoardMeta[]>([])
	const drainCancels = useRef(new Map<string, () => void>())

	/**
	 * Boards that have actually been activated this session. A reload can restore a dozen tabs, and
	 * mounting a dozen tldraw editors at startup would make launch cost scale with tab count — so an
	 * editor mounts the first time its tab is shown, then stays mounted while the tab is open.
	 */
	const warm = useRef(new Set<string>())

	/** Live editors by board id, for capturing a thumbnail before switching away. */
	const editors = useRef(new Map<string, Editor>())

	/**
	 * Re-exports every preview the theme change just invalidated.
	 *
	 * A thumbnail bakes in the theme it was made in, so a switch leaves the home grid showing the old
	 * palette. Every board with a mounted editor is re-exported here and keeps a real preview —
	 * including the inactive tabs, which are hidden but still mounted (see `withExportableHost`).
	 *
	 * Boards with no mounted editor have nothing to export *from*; exporting one would mean mounting a
	 * tldraw editor per board, which is the "thumbnail workers" idea the plan deliberately dropped. Those
	 * are cleared instead and regenerate the next time each board is opened and left.
	 *
	 * Serialised through a ref because an OS appearance change can arrive while a switch is still in
	 * flight, and two passes racing would have them clearing each other's fresh exports.
	 */
	const refreshing = useRef<Promise<void>>(Promise.resolve())
	const refreshThumbnails = useCallback(() => {
		refreshing.current = refreshing.current
			.then(async () => {
				// Read the editors when the turn actually starts, not when it was queued: a tab may have
				// opened or closed while an earlier pass was running.
				const mounted = [...editors.current.entries()]
				for (const [id, editor] of mounted) {
					await saveBoardThumbnail(platform.kv, id, editor)
				}
				await clearThumbnailsExcept(
					platform.kv,
					mounted.map(([id]) => id)
				)
			})
			// Keeps the chain alive: a rejected link would make every later switch a no-op.
			.catch((err) => console.warn('Lifeboard: could not refresh thumbnails for the new theme', err))
	}, [platform])

	const { theme, setTheme } = useTheme({ onRepaint: refreshThumbnails })
	// Tops up the exchange rates aggregations read. Nothing waits on it.
	useRates()

	/**
	 * Tells the canvas which colour mode to use.
	 *
	 * A per-editor `updateUserPreferences` rather than the `colorScheme` prop on `<Tldraw>`: that prop is
	 * in the dependency array of the effect that *constructs* the Editor, so binding it to state would
	 * remount every editor on a theme change — and unmounting inside tldraw's persistence throttle
	 * window discards the pending write (see DRAIN_MS above), along with the camera and undo history.
	 *
	 * Also deliberately not the module-level `setUserPreferences`: replacing the whole preferences object
	 * out from under mounted editors made their reactive store throw `AtomMap: key not found` on every
	 * update, which wedged navigation. This merges into the live value instead, which is what tldraw's
	 * own colour-scheme menu does.
	 *
	 * `theme` is passed through unresolved — tldraw understands `'system'` and tracks the OS itself.
	 *
	 * The ref is for editors that mount *later*: they are told on registration below, by which point
	 * this effect has already run.
	 */
	const themeRef = useRef(theme)
	themeRef.current = theme
	useEffect(() => {
		for (const editor of editors.current.values()) {
			editor.user.updateUserPreferences({ colorScheme: theme })
		}
	}, [theme])

	/**
	 * Grid and snapping (see canvasPrefs.ts).
	 *
	 * `isGridMode` is used here purely as tldraw's *snapping* flag — the grid you see is drawn by
	 * CanvasBackground, and `Grid: null` keeps tldraw's own from rendering. Applied per editor for the
	 * same reason as the theme, and re-applied on registration below because this is app-wide while
	 * tldraw persists the flag per board: without it, a board would keep whatever it was last left with.
	 */
	const canvasPrefs = useCanvasPrefsState()
	const snapRef = useRef(canvasPrefs.snapToGrid)
	snapRef.current = canvasPrefs.snapToGrid
	useEffect(() => {
		for (const editor of editors.current.values()) {
			editor.updateInstanceState({ isGridMode: canvasPrefs.snapToGrid })
		}
	}, [canvasPrefs.snapToGrid])

	/**
	 * Only the board you can see may take input.
	 *
	 * Every open tab keeps its editor mounted, and tldraw's `autoFocus` defaults to true — so each one
	 * sets `isFocused` on its own instance and nothing ever clears it, because a hidden board is never
	 * blurred by anything. That flag is the single gate on tldraw's clipboard listeners, its keyboard
	 * shortcuts *and* its document events, all of which bind to the **document** rather than to a
	 * container. With three tabs open, one ⌘V pasted three times, one ⌘Z undid three boards, and Delete
	 * reached shapes nobody was looking at.
	 *
	 * `focus({ focusContainer: false })` sets the flag without taking DOM focus: stealing it on every
	 * tab switch would yank the caret out of the tab-rename box, and tldraw reads keys off the document
	 * anyway. The blur side keeps its default, which also calls `editor.complete()` — a board being
	 * hidden mid-gesture should not keep a half-drawn arrow live.
	 *
	 * `keepEditing` is the exception, and the palette is what needs it. `blur()` is two things at once:
	 * clearing the flag, and completing the current interaction — which in the editing state means
	 * `setEditingShape(null)`. That is right for a board being hidden and wrong for one merely being
	 * talked over: opening the palette would end whatever was being edited underneath it, and a node
	 * whose editor is a whole surface — the book reader — would vanish at ⌘K. Only the flag gates
	 * tldraw's document listeners, so clearing just the flag is the whole of what the palette needs.
	 */
	const focusOnly = (activeId: string | null, keepEditing = false) => {
		for (const [id, editor] of editors.current) {
			if (id !== activeId) {
				if (keepEditing) editor.updateInstanceState({ isFocused: false })
				else editor.blur()
				continue
			}
			editor.focus({ focusContainer: false })
			// The console/e2e handle follows the board you are looking at, not whichever mounted last.
			// A board mounts asynchronously, so "last to mount" could be a tab restored behind this one
			// — and a handle pointing at an invisible board makes every command land where nobody sees
			// it. Left in place when you leave for the home screen: nothing has replaced it yet.
			;(window as unknown as { editor?: Editor }).editor = editor
		}
	}

	/**
	 * ⌘K opens the palette from anywhere.
	 *
	 * A window listener in the capture phase, deliberately **not** a tldraw action: tldraw binds its
	 * shortcuts to the document but gates them on `editor.getIsFocused()`, and `focusOnly` above blurs
	 * every editor the moment you leave the board view — so an override would be dead on the home
	 * screen, Settings and Help, which is most of where you want it. Capture plus `stopPropagation`
	 * also means tldraw and CodeMirror never see the keystroke at all.
	 */
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return
			event.preventDefault()
			event.stopPropagation()
			setPaletteOpen((open) => !open)
		}
		window.addEventListener('keydown', onKeyDown, { capture: true })
		return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
	}, [])

	// Ask for durable storage once, at startup. Chrome grants it silently based on engagement;
	// Safari grants it to installed PWAs. Either way, asking early is free (§4.4).
	useEffect(() => {
		void platform.requestPersistentStorage()
	}, [platform])

	useEffect(() => {
		const cancels = drainCancels.current
		return () => cancels.forEach((cancel) => cancel())
	}, [])

	const beginDrain = useCallback((board: BoardMeta) => {
		if (drainCancels.current.has(board.id)) return
		setDraining((d) => [...d.filter((b) => b.id !== board.id), board])
		drainCancels.current.set(
			board.id,
			startDrain({
				drainMs: DRAIN_MS,
				maxMs: MAX_DRAIN_MS,
				lastActivityAt: assetUploadActivityAt,
				onDone: () => {
					drainCancels.current.delete(board.id)
					setDraining((d) => d.filter((b) => b.id !== board.id))
				},
			})
		)
	}, [])

	const cancelDrainFor = useCallback((id: string) => {
		const cancel = drainCancels.current.get(id)
		if (!cancel) return
		cancel()
		drainCancels.current.delete(id)
		setDraining((d) => d.filter((b) => b.id !== id))
	}, [])

	// A board reached by any route — a tab click, a pasted link, back/forward — gets a tab, and
	// reopening a board whose closed tab is still draining stops the countdown: the editor is about
	// to be the active one again, and its timer firing mid-session would unmount it under the user.
	useEffect(() => {
		if (route.view !== 'board') return
		openTab(route.boardId)
		cancelDrainFor(route.boardId)
	}, [route, openTab, cancelDrainFor])

	// Activating an already-mounted tab needs two things onMount only does the first time: keyboard
	// focus back on that editor (or tool shortcuts go dead after a tab switch), and `window.editor`
	// (the debug/test seam) pointed at the *active* board rather than whichever mounted last.
	useEffect(() => {
		if (route.view !== 'board') return
		const editor = editors.current.get(route.boardId)
		if (editor) {
			;(window as unknown as { editor?: Editor }).editor = editor
			editor.focus()
		}
	}, [route])

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

	/**
	 * Capture the home-screen thumbnail of the active board before navigating away.
	 *
	 * Awaited on purpose: the export has to run while the board is still *visible* — exporting from
	 * a hidden board made tldraw drop every node background and font, so previews decayed into
	 * serif text. Bounded, because leaving a board must never be blocked by a thumbnail.
	 */
	const captureActiveThumbnail = useCallback(async () => {
		if (route.view !== 'board') return
		const editor = editors.current.get(route.boardId)
		if (!editor) return
		await Promise.race([
			saveBoardThumbnail(platform.kv, route.boardId, editor),
			new Promise((resolve) => setTimeout(resolve, THUMBNAIL_TIMEOUT_MS)),
		])
	}, [route, platform])

	const openBoard = useCallback(
		async (board: BoardMeta) => {
			if (route.view === 'board' && route.boardId === board.id) return
			openTab(board.id)
			await captureActiveThumbnail()
			navigate({ view: 'board', boardId: board.id })
		},
		[route, openTab, captureActiveThumbnail, navigate]
	)

	const goHome = useCallback(async () => {
		await captureActiveThumbnail()
		navigate({ view: 'list' })
		void api.refresh()
	}, [captureActiveThumbnail, navigate, api])

	const goSettings = useCallback(async () => {
		await captureActiveThumbnail()
		navigate({ view: 'settings' })
	}, [captureActiveThumbnail, navigate])

	const goHelp = useCallback(async () => {
		await captureActiveThumbnail()
		navigate({ view: 'help' })
	}, [captureActiveThumbnail, navigate])

	const createAndOpen = useCallback(async () => {
		const board = await api.create()
		await openBoard(board)
	}, [api, openBoard])

	const closeBoardTab = useCallback(
		async (id: string) => {
			const active = route.view === 'board' && route.boardId === id
			if (active) await captureActiveThumbnail()

			// Only a mounted editor can hold a pending write, so only warm tabs need the drain.
			const meta = api.boards.find((b) => b.id === id)
			if (meta && warm.current.has(id)) beginDrain(meta)
			warm.current.delete(id)
			closeTab(id)

			if (active) {
				const index = tabs.indexOf(id)
				const rest = tabs.filter((t) => t !== id)
				const nextId = rest[Math.min(index, rest.length - 1)]
				if (nextId) {
					navigate({ view: 'board', boardId: nextId })
				} else {
					navigate({ view: 'list' })
					void api.refresh()
				}
			}
		},
		[route, tabs, api, captureActiveThumbnail, beginDrain, closeTab, navigate]
	)

	/**
	 * Deleting a board that is still mounted would block its own delete: the editor holds an open
	 * connection to that database, so `deleteDatabase` never completes. Cancelling the drain and
	 * closing the tab first is safe precisely because we are about to throw the data away.
	 */
	const removeBoard = useCallback(
		async (id: string) => {
			cancelDrainFor(id)
			warm.current.delete(id)
			closeTab(id)
			// Give React a frame to commit the unmount so tldraw closes its connection.
			await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
			await api.remove(id)
		},
		[cancelDrainFor, closeTab, api]
	)

	// Re-point the command table's app capability at this render's callbacks (see appCommands.ts for
	// why the commands themselves register at module scope instead of here). No dependency array on
	// purpose: the callbacks are recreated across renders, and a stale set would run dead closures.
	useEffect(() => {
		setAppCommandApi({ createAndOpen, goHome, goSettings, goHelp, setTheme })
	})

	const listApi = { ...api, remove: removeBoard }

	const activeBoardId = route.view === 'board' ? route.boardId : null
	// A board mounting is asynchronous — it waits on its own restore — so registration below has to
	// apply this too, and needs the *current* active board rather than the one at its render.
	const activeBoardIdRef = useRef(activeBoardId)
	activeBoardIdRef.current = activeBoardId
	useEffect(() => {
		// An open palette counts as "no board has focus", and this is the whole of the palette's focus
		// story: tldraw reads keys off the *document* and gates them on `isFocused`, so without the
		// blur every letter typed into the palette would also switch the canvas tool underneath it.
		// Closing restores focus by itself — this effect runs on every render, including that one.
		// `keepEditing`, because the palette is a thing you open *over* your work, not instead of it.
		focusOnly(paletteOpen ? null : activeBoardId, paletteOpen)
		// Leaving the board view for the home screen blurs everything, which is right: a keystroke
		// aimed at the board list must not reach a board that happens to still be mounted behind it.
	})
	if (activeBoardId) warm.current.add(activeBoardId)

	/**
	 * What a command runs against, read at the moment of invocation rather than captured — the
	 * editors map is a ref, so anything stored would be stale the next time a tab changed.
	 */
	const getCommandContext = useCallback(
		(): CommandContext => ({
			editor: activeBoardId ? (editors.current.get(activeBoardId) ?? null) : null,
			view: route.view,
		}),
		[activeBoardId, route.view]
	)

	const routedBoard = activeBoardId
		? api.boards.find((b) => b.id === activeBoardId)
		: undefined

	// Everything that must stay mounted: open tabs that have been shown at least once, plus closed
	// tabs still draining. Keys are board ids, so a board moving between the two groups keeps its
	// editor instance — remounting would create a fresh sync client and lose the pending write.
	const byId = new Map(api.boards.map((b) => [b.id, b]))
	const mounted: BoardMeta[] = []
	const seen = new Set<string>()
	for (const id of tabs) {
		if (!warm.current.has(id)) continue
		const meta = byId.get(id)
		if (meta) {
			mounted.push(meta)
			seen.add(id)
		}
	}
	for (const board of draining) if (!seen.has(board.id)) mounted.push(board)

	return (
		<CanvasPrefsProvider value={canvasPrefs}>
			<CommandPalette
				open={paletteOpen}
				onClose={() => setPaletteOpen(false)}
				getContext={getCommandContext}
				boards={api.boards}
				onOpenBoard={(board) => void openBoard(board)}
			/>
			<div className={sidebarCollapsed ? 'lb-shell lb-shell--sidebar-collapsed' : 'lb-shell'}>
				<Sidebar
					view={route.view}
					activeBoardId={activeBoardId}
					boards={api.boards}
					collapsed={sidebarCollapsed}
					onToggleCollapsed={() => updateSidebarCollapsed(!sidebarCollapsed)}
					onAllBoards={() => void goHome()}
					onSettings={() => void goSettings()}
					onHelp={() => void goHelp()}
					onOpenBoard={(board) => void openBoard(board)}
					onNewBoard={() => void createAndOpen()}
				/>
				<button
					type="button"
					className="lb-sidebar__scrim"
					onClick={() => updateSidebarCollapsed(true)}
					aria-label="Collapse sidebar"
				/>

				<div className="lb-shell__body">
				<TabStrip
					boards={api.boards}
					tabs={tabs}
					view={route.view}
					activeBoardId={activeBoardId}
					onHome={() => void goHome()}
					onSelect={(board) => void openBoard(board)}
					onClose={(id) => void closeBoardTab(id)}
					onNew={() => void createAndOpen()}
					onRename={(id, name) => void api.rename(id, name)}
				/>

				<div className="lb-shell__content">
					{mounted.map((board) => (
						<div
							key={board.id}
							className="lb-board-host"
							{...(board.id === activeBoardId ? {} : { 'data-hidden': 'true' })}
						>
							<Board
								board={board}
								seedDemo={
									route.view === 'board' &&
									route.boardId === board.id &&
									route.seedDemo === true
								}
								onEditor={(editor) => {
									if (editor) {
										editors.current.set(board.id, editor)
										focusOnly(activeBoardIdRef.current)
										// A board can mount long after these were chosen — on a restored tab, or the
										// first time an already-open tab is shown.
										editor.user.updateUserPreferences({ colorScheme: themeRef.current })
										editor.updateInstanceState({ isGridMode: snapRef.current })
									} else editors.current.delete(board.id)
								}}
							/>
						</div>
					))}

					{route.view === 'board' &&
						(api.loading ? (
							<div className="lb-board__loading">Loading…</div>
						) : !routedBoard ? (
							// A stale hash (deleted board, or an old link) should land somewhere useful.
							<div className="lb-list__empty">
								<p>That board no longer exists.</p>
								<button className="lb-btn" onClick={() => void goHome()}>
									Back to all boards
								</button>
							</div>
						) : null)}

					{route.view === 'list' &&
						(seeding ? (
							// Without this, first run would flash the "No boards yet" empty state between
							// the index loading and the demo board being created.
							<div className="lb-board__loading">Setting up your first board…</div>
						) : (
							<BoardList api={listApi} onOpen={(board) => void openBoard(board)} />
						))}

					{route.view === 'settings' && (
						<main className="lb-home__main">
							{/* A column, centred. Settings is a reading width of controls, not a grid that
							    wants the whole window — pinned to the left edge of a wide screen it reads
							    as a panel someone forgot to lay out. */}
							<div className="lb-settings-page">
								<header className="lb-home__header">
									<h1>Settings</h1>
								</header>
								<AppearancePanel theme={theme} onThemeChange={setTheme} canvas={canvasPrefs} />
								<ExtensionsPanel />
								<SettingsPanel api={api} onImported={() => void goHome()} />
							</div>
						</main>
					)}

					{/* Owns its own layout and scrolling, unlike the other views: the section rail has to
					    stay put while the section beside it scrolls. */}
					{route.view === 'help' && (
						<HelpPage
							section={route.section}
							onSection={(section) => navigate({ view: 'help', section })}
						/>
					)}
					</div>
				</div>
			</div>
		</CanvasPrefsProvider>
	)
}
