import type { Editor } from '@lifeboard/canvas'
import type { KvStore, PlatformAdapter } from '../platform/PlatformAdapter'
import type { BoardMeta } from './boardIndex'
import { moveBoardToDevice, moveBoardToServer, type MoveStage } from './moveBoard'

/**
 * Boards on their way between this browser and the server, kept in this browser's own store so a
 * reload neither loses them nor hides them: the queue picks up where it was, and the board list and
 * sidebar show it. One board at a time and in order, so a failure says which board and leaves the
 * rest where they were. Each step of a move is safe to run twice (boards/moveBoard.ts).
 */
export interface MoveJob {
	board: BoardMeta
	to: 'server' | 'device'
	stage: 'waiting' | 'starting' | MoveStage
	filesDone: number
	filesTotal: number
	/** Why it stopped. A failed move waits for Retry or Dismiss; the queue goes on without it. */
	error?: string
}

const KEY = 'moves'
const BATCH_KEY = 'movesBatch'

let jobs: readonly MoveJob[] = []
/** How many boards the current run of moves started with, for "3 of 7". Back to 0 once it is done. */
let batchTotal = 0
let loaded = false
const listeners = new Set<() => void>()

export function getMoves(): readonly MoveJob[] {
	return jobs
}

/** Boards moved so far in this run, and how many it has in all. */
export function getMoveBatch(): { done: number; total: number } {
	return { done: Math.max(0, batchTotal - jobs.length), total: Math.max(batchTotal, jobs.length) }
}

export function subscribeToMoves(listener: () => void): () => void {
	listeners.add(listener)
	return () => listeners.delete(listener)
}

/** The move a board is in, if any. */
export function moveFor(boardId: string): MoveJob | undefined {
	return jobs.find((job) => job.board.id === boardId)
}

async function setJobs(kv: KvStore, next: readonly MoveJob[]): Promise<void> {
	jobs = next
	if (!next.length) batchTotal = 0
	for (const listener of listeners) listener()
	await kv.set(KEY, next)
	await kv.set(BATCH_KEY, batchTotal)
}

function update(kv: KvStore, boardId: string, patch: Partial<MoveJob>): Promise<void> {
	return setJobs(
		kv,
		jobs.map((job) => (job.board.id === boardId ? { ...job, ...patch } : job))
	)
}

export interface MoveRunner {
	platform: PlatformAdapter
	/** A board's live editor if it is open: fresher than what is on disk. */
	editorFor(boardId: string): Editor | undefined
	/** Called as each board arrives, so the lists show it where it now lives. */
	onMoved(): Promise<void>
}

let runner: MoveRunner | null = null
let running = false

/** Restores the queue from the last visit and starts on it. Called once, when the app has a server. */
export async function startMoves(next: MoveRunner): Promise<void> {
	runner = next
	if (!loaded) {
		loaded = true
		const saved = (await next.platform.kv.get<MoveJob[]>(KEY)) ?? []
		batchTotal = saved.length ? ((await next.platform.kv.get<number>(BATCH_KEY)) ?? saved.length) : 0
		// A move cut off mid-step starts that step again; the steps don't mind.
		jobs = saved.map((job) => (job.error ? job : { ...job, stage: 'waiting' as const }))
		for (const listener of listeners) listener()
	}
	void run()
}

/** Queues these boards to move to whichever side each isn't on. Boards already queued are left be. */
export async function queueMoves(kv: KvStore, boards: readonly BoardMeta[]): Promise<void> {
	const fresh = boards
		.filter((board) => !moveFor(board.id))
		.map(
			(board): MoveJob => ({
				board,
				to: board.vault === 'server' ? 'device' : 'server',
				stage: 'waiting',
				filesDone: 0,
				filesTotal: 0,
			})
		)
	if (!fresh.length) return
	batchTotal = Math.max(batchTotal, jobs.length) + fresh.length
	await setJobs(kv, [...jobs, ...fresh])
	void run()
}

export async function retryMove(kv: KvStore, boardId: string): Promise<void> {
	const job = moveFor(boardId)
	if (!job) return
	const { error: _error, ...rest } = job
	await setJobs(
		kv,
		jobs.map((j) => (j.board.id === boardId ? { ...rest, stage: 'waiting' as const } : j))
	)
	void run()
}

export async function dismissMove(kv: KvStore, boardId: string): Promise<void> {
	await setJobs(
		kv,
		jobs.filter((job) => job.board.id !== boardId)
	)
}

async function run(): Promise<void> {
	if (running || !runner) return
	running = true
	const { platform, editorFor, onMoved } = runner
	try {
		for (let job = jobs.find((j) => !j.error); job; job = jobs.find((j) => !j.error)) {
			const id = job.board.id
			const progress = (stage: MoveStage, filesDone?: number, filesTotal?: number) =>
				void update(platform.kv, id, {
					stage,
					...(filesDone !== undefined ? { filesDone } : {}),
					...(filesTotal !== undefined ? { filesTotal } : {}),
				})
			try {
				// Under way from here, even while it is still asking the server where it got to.
				await update(platform.kv, id, { stage: 'starting' })
				if (job.to === 'server') await moveBoardToServer(platform, job.board, editorFor(id), progress)
				else await moveBoardToDevice(platform, job.board, progress)
				await setJobs(
					platform.kv,
					jobs.filter((j) => j.board.id !== id)
				)
			} catch (error) {
				await update(platform.kv, id, { error: error instanceof Error ? error.message : String(error) })
			}
			await onMoved()
		}
	} finally {
		running = false
	}
}
