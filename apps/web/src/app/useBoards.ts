import { useCallback, useEffect, useMemo, useState } from 'react'
import {
	createBoard,
	listBoards,
	renameBoard,
	setBoardFavorite,
	type BoardMeta,
} from '../boards/boardIndex'
import { deleteBoard } from '../boards/deleteBoard'
import { usePlatform } from '../platform/PlatformContext'

export interface BoardsApi {
	boards: BoardMeta[]
	loading: boolean
	create(name?: string): Promise<BoardMeta>
	rename(id: string, name: string): Promise<void>
	setFavorite(id: string, favorite: boolean): Promise<void>
	remove(id: string): Promise<void>
	refresh(): Promise<void>
}

export function useBoards(): BoardsApi {
	const platform = usePlatform()
	const [boards, setBoards] = useState<BoardMeta[]>([])
	const [loading, setLoading] = useState(true)

	const refresh = useCallback(async () => {
		setBoards(await listBoards(platform.kv))
	}, [platform])

	useEffect(() => {
		void refresh().finally(() => setLoading(false))
	}, [refresh])

	const create = useCallback(
		async (name?: string) => {
			const board = await createBoard(platform.kv, name)
			await refresh()
			return board
		},
		[platform, refresh]
	)

	const rename = useCallback(
		async (id: string, name: string) => {
			await renameBoard(platform.kv, id, name)
			await refresh()
		},
		[platform, refresh]
	)

	const setFavorite = useCallback(
		async (id: string, favorite: boolean) => {
			await setBoardFavorite(platform.kv, id, favorite)
			await refresh()
		},
		[platform, refresh]
	)

	const remove = useCallback(
		async (id: string) => {
			await deleteBoard(platform, id)
			await refresh()
		},
		[platform, refresh]
	)

	// Memoized deliberately, not as micro-optimisation: a fresh object literal here would change
	// identity on every render, re-running every consumer effect that depends on the API — which is
	// exactly how the first-run demo seeding used to cancel itself before it could navigate.
	return useMemo(
		() => ({ boards, loading, create, rename, setFavorite, remove, refresh }),
		[boards, loading, create, rename, setFavorite, remove, refresh]
	)
}
