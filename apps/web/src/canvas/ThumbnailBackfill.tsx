import {
	createTLStore,
	defaultBindingUtils,
	loadSnapshot,
	Tldraw,
	type Editor,
	type TLStoreSnapshot,
} from '@lifeboard/canvas'
import { STORE_MIGRATIONS } from '@lifeboard/schema'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { BoardMeta } from '../boards/boardIndex'
import { moveFor } from '../boards/moveQueue'
import { createLifeboardAssetStore } from '../persistence/assetStore'
import { takePendingRestore } from '../persistence/pendingRestore'
import { loadTheme, useResolvedTheme, type ResolvedTheme } from '../app/useTheme'
import { forgetUnthemedThumbnails, loadBoardThumbnail, saveBoardThumbnail } from '../persistence/thumbnails'
import { readBoardSnapshotResult } from '../persistence/tldrawLocalDb'
import { usePlatform } from '../platform/PlatformContext'
import type { PlatformAdapter } from '../platform/PlatformAdapter'
import { fetchServerAsset, fetchServerThumbnail, readServerBoard } from '../server/serverVault'
import { buildBoardShapeUtils, buildStoreShapeUtils } from './boardShapeUtils'
import { getShapeVisibility } from './relationVisibility'

/**
 * Draws previews for boards that have none, so every card on the home screen has a picture of its
 * board without the board being opened first: boards moved from another device, imported, made by an
 * agent, or with no preview in the theme on screen.
 *
 * One board at a time, in a hidden editor off screen that never takes focus: the board's own node
 * types, visibility rules and files, so the picture is what opening it would show. The preview is
 * saved like any other (persistence/thumbnails.ts), and a server board's goes on to the server for
 * every other device (app/App.tsx). A server board's preview drawn before its last edit, likely on
 * another device, is drawn again. Each board is tried once per visit and theme; an empty one keeps its
 * placeholder.
 */
export function ThumbnailBackfill({ boards }: { boards: readonly BoardMeta[] }) {
	const platform = usePlatform()
	const theme = useResolvedTheme()
	const [current, setCurrent] = useState<{ board: BoardMeta; snapshot: TLStoreSnapshot } | null>(null)
	const tried = useRef(new Set<string>())
	const next = useCallback(() => setCurrent(null), [])

	useEffect(() => {
		void forgetUnthemedThumbnails(platform.kv)
	}, [platform])

	useEffect(() => {
		if (current) return
		let cancelled = false
		void (async () => {
			for (const board of boards) {
				// A moving board is between two homes; it gets its turn once it arrives.
				const attempt = `${theme}:${board.id}`
				if (tried.current.has(attempt) || moveFor(board.id)) continue
				tried.current.add(attempt)
				try {
					if (await hasPreview(platform, board, theme)) continue
					const snapshot = await readBoard(platform, board)
					if (!snapshot || Object.keys(snapshot.store).length === 0) continue
					if (!cancelled) setCurrent({ board, snapshot })
					return
				} catch (error) {
					console.warn(`Lifeboard: could not draw a preview of “${board.name}”`, error)
				}
			}
		})()
		return () => {
			cancelled = true
		}
	}, [boards, current, platform, theme])

	if (!current) return null
	return (
		<OffscreenBoard
			key={current.board.id}
			board={current.board}
			snapshot={current.snapshot}
			onDone={next}
		/>
	)
}

async function hasPreview(platform: PlatformAdapter, board: BoardMeta, theme: ResolvedTheme): Promise<boolean> {
	if (board.vault !== 'server') return (await loadBoardThumbnail(platform.kv, board.id, theme)) !== undefined
	const preview = await fetchServerThumbnail(board.id, theme)
	return preview !== null && preview.drawnAt >= board.updatedAt
}

/** The board's records as they are stored: on the server, on disk, or still waiting as an import. */
async function readBoard(platform: PlatformAdapter, board: BoardMeta): Promise<TLStoreSnapshot | undefined> {
	if (board.vault === 'server') return (await readServerBoard(board.id)) as unknown as TLStoreSnapshot
	const result = await readBoardSnapshotResult(board.id)
	if (result.status === 'ok') return result.snapshot as unknown as TLStoreSnapshot
	return (await takePendingRestore(platform.kv, board.id)) as unknown as TLStoreSnapshot | undefined
}

/** Long enough for nodes that render after mount (markdown, tables, fonts) to settle before the picture. */
const SETTLE_MS = 600

function OffscreenBoard({
	board,
	snapshot,
	onDone,
}: {
	board: BoardMeta
	snapshot: TLStoreSnapshot
	onDone: () => void
}) {
	const platform = usePlatform()
	const shapeUtils = useMemo(buildBoardShapeUtils, [])
	const store = useMemo(() => {
		const store = createTLStore({
			shapeUtils: buildStoreShapeUtils(shapeUtils),
			bindingUtils: defaultBindingUtils,
			migrations: STORE_MIGRATIONS,
			assets: createLifeboardAssetStore(platform.blobs, fetchServerAsset),
		})
		loadSnapshot(store, snapshot)
		return store
	}, [platform, shapeUtils, snapshot])

	const finished = useRef(false)
	const draw = async (editor: Editor) => {
		await document.fonts.ready
		await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
		if (finished.current) return
		await saveBoardThumbnail(platform.kv, board.id, editor)
		finished.current = true
		onDone()
	}
	// The drawing's own timeout: a board that never settles must not hold up the rest.
	useEffect(() => {
		const timer = setTimeout(() => {
			if (!finished.current) {
				finished.current = true
				onDone()
			}
		}, 20_000)
		return () => clearTimeout(timer)
	}, [onDone])

	return createPortal(
		<div className="lb-offscreen-board" aria-hidden="true">
			<Tldraw
				store={store}
				shapeUtils={shapeUtils}
				getShapeVisibility={getShapeVisibility}
				hideUi
				autoFocus={false}
				onMount={(editor) => {
					// The app's theme, so the preview matches the cards around it. The canvas keeps its own
					// colour preference, shared by every editor, which only follows the app once a board has
					// been open (App tells mounted editors); until then it can be anything.
					editor.user.updateUserPreferences({ colorScheme: loadTheme() })
					editor.zoomToFit({ animation: { duration: 0 } })
					void draw(editor)
				}}
			/>
		</div>,
		document.body
	)
}
