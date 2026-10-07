import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
	createBoard,
	isSharedWithMe,
	listBoards,
	renameBoard,
	setBoardFavorite,
	type BoardMeta,
} from '../boards/boardIndex'
import { deleteBoard } from '../boards/deleteBoard'
import { getMoves, queueMoves, subscribeToMoves, type MoveJob } from '../boards/moveQueue'
import { deleteBoardThumbnail } from '../persistence/thumbnails'
import { usePlatform } from '../platform/PlatformContext'
import {
	createServerBoard,
	deleteServerBoard,
	listServerBoards,
	updateServerBoard,
} from '../server/serverVault'
import { syncVaultSettings } from './vaultSettings'
import { removeBoardAccess } from '../server/accounts'

export interface BoardsApi {
	boards: BoardMeta[]
	loading: boolean
	/** Whether a server vault answered. New boards go there when it did. */
	hasServer: boolean
	/**
	 * Whether this device has a server vault it can't reach now. Its boards are still listed, as last
	 * seen, and open from their copies here; new boards stay on this device.
	 */
	serverOffline: boolean
	create(name?: string): Promise<BoardMeta>
	rename(id: string, name: string): Promise<void>
	setFavorite(id: string, favorite: boolean): Promise<void>
	remove(id: string): Promise<void>
	/**
	 * Queues these boards to move: to the server if they are on this device, and back if they are on
	 * the server. The queue survives a reload and shows its progress (boards/moveQueue.ts).
	 */
	move(boards: readonly BoardMeta[]): Promise<void>
	refresh(): Promise<void>
}

const byRecent = (a: BoardMeta, b: BoardMeta) => b.updatedAt - a.updatedAt

/**
 * Every board the app can open: this browser's, and the server vault's when there is one. One list,
 * so the sidebar, tabs and ⌘K need not know there are two places a board can live.
 */
export function useBoards(): BoardsApi {
	const platform = usePlatform()
	const [local, setLocal] = useState<BoardMeta[]>([])
	const [server, setServer] = useState<BoardMeta[] | null>(null)
	const [serverOnline, setServerOnline] = useState(false)
	const [loading, setLoading] = useState(true)

	const refreshServer = useCallback(async () => {
		try {
			const listed = await listServerBoards(platform.kv)
			setServer(listed?.boards ?? null)
			setServerOnline(listed?.online ?? false)
			if (listed?.online) await syncVaultSettings()
		} catch (error) {
			// A server that answered and then failed: keep the boards we last saw rather than hide them.
			console.error('Lifeboard: could not read the server vault.', error)
		}
	}, [platform])

	const refresh = useCallback(async () => {
		await Promise.all([listBoards(platform.kv).then(setLocal), refreshServer()])
	}, [platform, refreshServer])

	useEffect(() => {
		void refresh().finally(() => setLoading(false))
	}, [refresh])

	// Another device may have added, renamed or deleted a board. A board list needs no live push;
	// coming back to the window, or back online, is when it matters.
	useEffect(() => {
		const onFocus = () => void refreshServer()
		window.addEventListener('focus', onFocus)
		window.addEventListener('online', onFocus)
		return () => {
			window.removeEventListener('focus', onFocus)
			window.removeEventListener('online', onFocus)
		}
	}, [refreshServer])

	// By id: a board half-way through a move is briefly on both sides, and is still one board.
	const boards = useMemo(
		() => [...new Map([...local, ...(server ?? [])].map((board) => [board.id, board])).values()].sort(byRecent),
		[local, server]
	)
	const isServerBoard = useCallback(
		(id: string) => server?.some((b) => b.id === id) ?? false,
		[server]
	)

	const create = useCallback(
		async (name = 'Untitled board') => {
			// Offline, a new board starts on this device; it can be moved to the server later.
			const board = server && serverOnline ? await createServerBoard(name) : await createBoard(platform.kv, name)
			await refresh()
			return board
		},
		[platform, server, serverOnline, refresh]
	)

	const rename = useCallback(
		async (id: string, name: string) => {
			if (isServerBoard(id)) await updateServerBoard(id, { name })
			else await renameBoard(platform.kv, id, name)
			await refresh()
		},
		[platform, isServerBoard, refresh]
	)

	const setFavorite = useCallback(
		async (id: string, favorite: boolean) => {
			if (isServerBoard(id)) await updateServerBoard(id, { favorite })
			else await setBoardFavorite(platform.kv, id, favorite)
			await refresh()
		},
		[platform, isServerBoard, refresh]
	)

	const remove = useCallback(
		async (id: string) => {
			const shared = server?.find((board) => board.id === id)
			if (shared && isSharedWithMe(shared)) {
				// Not ours to delete: it just leaves this account's list.
				await removeBoardAccess(id, 'me')
				await deleteBoardThumbnail(platform.kv, id)
			} else if (isServerBoard(id)) {
				await deleteServerBoard(id)
				await deleteBoardThumbnail(platform.kv, id)
			} else await deleteBoard(platform, id)
			await refresh()
		},
		[platform, server, isServerBoard, refresh]
	)

	const move = useCallback((boards: readonly BoardMeta[]) => queueMoves(platform.kv, boards), [platform])

	// Memoized deliberately, not as micro-optimisation: a fresh object literal here would change
	// identity on every render, re-running every consumer effect that depends on the API — which is
	// exactly how the first-run demo seeding used to cancel itself before it could navigate.
	return useMemo(
		() => ({
			boards,
			loading,
			hasServer: server !== null && serverOnline,
			serverOffline: server !== null && !serverOnline,
			create,
			rename,
			setFavorite,
			remove,
			move,
			refresh,
		}),
		[boards, loading, server, serverOnline, create, rename, setFavorite, remove, move, refresh]
	)
}

/** The boards on their way between this browser and the server, live. */
export function useMoves(): readonly MoveJob[] {
	return useSyncExternalStore(subscribeToMoves, getMoves)
}
