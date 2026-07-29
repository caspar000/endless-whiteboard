import type { KvStore } from '../platform/PlatformAdapter'

/**
 * The board index: a small store of board metadata, deliberately separate from canvas content
 * (§4.4). That separation is what lets the index become the workspace/membership model under future
 * sync without touching board content, and it means listing boards never loads a single shape.
 */
export interface BoardMeta {
	id: string
	name: string
	createdAt: number
	updatedAt: number
}

const INDEX_KEY = 'boards'
const LAST_BACKUP_KEY = 'lastBackupAt'
const DEMO_SEEDED_KEY = 'demoSeeded'

export function newBoardId(): string {
	return crypto.randomUUID()
}

function sortBoards(boards: BoardMeta[]): BoardMeta[] {
	return [...boards].sort((a, b) => b.updatedAt - a.updatedAt)
}

function isBoardMeta(value: unknown): value is BoardMeta {
	if (!value || typeof value !== 'object') return false
	const b = value as Partial<BoardMeta>
	return (
		typeof b.id === 'string' &&
		typeof b.name === 'string' &&
		typeof b.createdAt === 'number' &&
		typeof b.updatedAt === 'number'
	)
}

export async function listBoards(kv: KvStore): Promise<BoardMeta[]> {
	const raw = await kv.get<unknown>(INDEX_KEY)
	if (!Array.isArray(raw)) return []
	// Defensive filter: the index survives app upgrades and hand-edited backups, so a malformed
	// entry must not take down the board list.
	return sortBoards(raw.filter(isBoardMeta))
}

async function writeBoards(kv: KvStore, boards: BoardMeta[]): Promise<void> {
	await kv.set(INDEX_KEY, sortBoards(boards))
}

export async function createBoard(kv: KvStore, name = 'Untitled board'): Promise<BoardMeta> {
	const now = Date.now()
	const board: BoardMeta = { id: newBoardId(), name, createdAt: now, updatedAt: now }
	await writeBoards(kv, [...(await listBoards(kv)), board])
	return board
}

/** Adds a board that already has an id — used by backup import's restore-as-copy. */
export async function addBoard(kv: KvStore, board: BoardMeta): Promise<void> {
	const boards = (await listBoards(kv)).filter((b) => b.id !== board.id)
	await writeBoards(kv, [...boards, board])
}

export async function renameBoard(kv: KvStore, id: string, name: string): Promise<void> {
	const boards = await listBoards(kv)
	await writeBoards(
		kv,
		boards.map((b) => (b.id === id ? { ...b, name, updatedAt: Date.now() } : b))
	)
}

export async function touchBoard(kv: KvStore, id: string): Promise<void> {
	const boards = await listBoards(kv)
	const board = boards.find((b) => b.id === id)
	if (!board) return
	await writeBoards(kv, boards.map((b) => (b.id === id ? { ...b, updatedAt: Date.now() } : b)))
}

/** Removes the index entry only. Canvas data and asset GC are the caller's job — see `deleteBoard`
 * in `boards/deleteBoard.ts`, which sequences all three. */
export async function removeBoardFromIndex(kv: KvStore, id: string): Promise<void> {
	const boards = await listBoards(kv)
	await writeBoards(
		kv,
		boards.filter((b) => b.id !== id)
	)
}

export async function getBoard(kv: KvStore, id: string): Promise<BoardMeta | undefined> {
	return (await listBoards(kv)).find((b) => b.id === id)
}

// --- backup bookkeeping (drives the "last backup N days ago" nag, §4.4) ---

export async function getLastBackupAt(kv: KvStore): Promise<number | null> {
	return (await kv.get<number>(LAST_BACKUP_KEY)) ?? null
}

export async function setLastBackupAt(kv: KvStore, at = Date.now()): Promise<void> {
	await kv.set(LAST_BACKUP_KEY, at)
}

export async function wasDemoSeeded(kv: KvStore): Promise<boolean> {
	return (await kv.get<boolean>(DEMO_SEEDED_KEY)) === true
}

export async function markDemoSeeded(kv: KvStore): Promise<void> {
	await kv.set(DEMO_SEEDED_KEY, true)
}
