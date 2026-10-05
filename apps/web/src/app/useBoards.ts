import { useCallback, useEffect, useMemo, useState } from 'react'
import {
	createBoard,
	listBoards,
	renameBoard,
	setBoardFavorite,
	type BoardMeta,
} from '../boards/boardIndex'
import { deleteBoard } from '../boards/deleteBoard'
import { deleteBoardThumbnail } from '../persistence/thumbnails'
import { usePlatform } from '../platform/PlatformContext'
import {
	createServerBoard,
	deleteServerBoard,
	listServerBoards,
	updateServerBoard,
} from '../server/serverVault'

export interface BoardsApi {
	boards: BoardMeta[]
	loading: boolean
	/** Whether a server vault answered. New boards go there when it did. */
	hasServer: boolean
	create(name?: string): Promise<BoardMeta>
	rename(id: string, name: string): Promise<void>
	setFavorite(id: string, favorite: boolean): Promise<void>
	remove(id: string): Promise<void>
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
	const [loading, setLoading] = useState(true)

	const refreshServer = useCallback(async () => {
		try {
			setServer(await listServerBoards())
		} catch (error) {
			// A server that answered and then failed: keep the boards we last saw rather than hide them.
			console.error('Lifeboard: could not list the server’s boards.', error)
		}
	}, [])

	const refresh = useCallback(async () => {
		await Promise.all([listBoards(platform.kv).then(setLocal), refreshServer()])
	}, [platform, refreshServer])

	useEffect(() => {
		void refresh().finally(() => setLoading(false))
	}, [refresh])

	// Another device may have added, renamed or deleted a board. A board list needs no live push;
	// coming back to the window is when it matters.
	useEffect(() => {
		const onFocus = () => void refreshServer()
		window.addEventListener('focus', onFocus)
		return () => window.removeEventListener('focus', onFocus)
	}, [refreshServer])

	const boards = useMemo(() => [...local, ...(server ?? [])].sort(byRecent), [local, server])
	const isServerBoard = useCallback(
		(id: string) => server?.some((b) => b.id === id) ?? false,
		[server]
	)

	const create = useCallback(
		async (name = 'Untitled board') => {
			const board = server ? await createServerBoard(name) : await createBoard(platform.kv, name)
			await refresh()
			return board
		},
		[platform, server, refresh]
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
			if (isServerBoard(id)) {
				await deleteServerBoard(id)
				await deleteBoardThumbnail(platform.kv, id)
			} else await deleteBoard(platform, id)
			await refresh()
		},
		[platform, isServerBoard, refresh]
	)

	// Memoized deliberately, not as micro-optimisation: a fresh object literal here would change
	// identity on every render, re-running every consumer effect that depends on the API — which is
	// exactly how the first-run demo seeding used to cancel itself before it could navigate.
	return useMemo(
		() => ({ boards, loading, hasServer: server !== null, create, rename, setFavorite, remove, refresh }),
		[boards, loading, server, create, rename, setFavorite, remove, refresh]
	)
}
