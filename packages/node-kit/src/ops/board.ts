import { defineOperation, fail, ok, type JsonValue, type RegisteredOperation } from '../operations'
import type { BoardSummary } from '../boardBridge'

function summary(board: BoardSummary): JsonValue {
	return {
		id: board.id,
		name: board.name,
		createdAt: board.createdAt,
		updatedAt: board.updatedAt,
		favorite: board.favorite ?? false,
	}
}

export const boardOperations: RegisteredOperation[] = [
	defineOperation({
		id: 'board.list',
		title: 'List boards',
		description:
			'Every board in this workspace, most recently edited first. Start here: the ids returned are what every other operation means by boardId.',
		readOnly: true,
		params: {},
		run: async (ctx) => {
			const boards = await ctx.boards.list()
			return ok(boards.map(summary))
		},
	}),

	defineOperation({
		id: 'board.create',
		title: 'Create board',
		description:
			'Makes a new, empty board and returns it. Opens it on screen unless told not to, so subsequent operations can omit boardId.',
		params: {
			name: { type: 'string', description: 'What to call it. Defaults to "Untitled board".' },
			open: {
				type: 'boolean',
				description:
					'Open the new board on screen. Defaults to true — a board nobody can see is rarely what was wanted.',
			},
		},
		run: async (ctx, args) => {
			const board = await ctx.boards.create(args.name?.trim() || 'Untitled board')
			if (args.open !== false) await ctx.boards.open(board.id)
			return ok(summary(board))
		},
	}),

	defineOperation({
		id: 'board.open',
		title: 'Open board',
		description:
			'Brings a board on screen and waits for it to be ready. Only needed to change what the person watching sees — every other operation takes a boardId and opens it itself.',
		params: {
			boardId: { type: 'string', description: 'The board to open.', required: true },
		},
		run: async (ctx, args) => {
			const editor = await ctx.boards.open(args.boardId)
			if (!editor) return fail(`No board with id "${args.boardId}".`)
			return ok({ id: args.boardId, opened: true })
		},
	}),

	defineOperation({
		id: 'board.rename',
		title: 'Rename board',
		description: 'Changes a board’s name. Its contents and id are untouched.',
		params: {
			boardId: { type: 'string', description: 'The board to rename.', required: true },
			name: { type: 'string', description: 'The new name.', required: true },
		},
		run: async (ctx, args) => {
			const name = args.name.trim()
			if (!name) return fail('A board name cannot be empty.')
			const boards = await ctx.boards.list()
			if (!boards.some((board) => board.id === args.boardId)) {
				return fail(`No board with id "${args.boardId}".`)
			}
			await ctx.boards.rename(args.boardId, name)
			return ok({ id: args.boardId, name })
		},
	}),

	defineOperation({
		id: 'board.delete',
		title: 'Delete board',
		/*
		 * The only irreversible operation in the table, and the only one that asks for confirmation.
		 *
		 * Every other write lands in tldraw's undo history, so a human watching an agent go wrong can
		 * ⌘Z it. Deleting a board destroys its canvas database and garbage-collects the assets only it
		 * referenced — there is no undo entry to come back to. `confirm` costs a correct caller nothing
		 * and turns an agent's stray tool call into an error message instead of lost work.
		 */
		description:
			'Permanently deletes a board and everything on it. THIS CANNOT BE UNDONE — it is not in the undo history. Requires confirm: true. Check with board.list first.',
		params: {
			boardId: { type: 'string', description: 'The board to delete.', required: true },
			confirm: {
				type: 'boolean',
				description:
					'Must be true. Set it only if deleting this board is what was actually asked for.',
				required: true,
			},
		},
		run: async (ctx, args) => {
			if (args.confirm !== true) {
				return fail('Refusing to delete: pass confirm: true if this is really intended.')
			}
			const boards = await ctx.boards.list()
			const board = boards.find((candidate) => candidate.id === args.boardId)
			if (!board) return fail(`No board with id "${args.boardId}".`)
			await ctx.boards.remove(args.boardId)
			return ok({ id: args.boardId, name: board.name, deleted: true })
		},
	}),
]
