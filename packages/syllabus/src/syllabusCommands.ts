import { defineOperation, fail, ok, type Command, type FileImport, type JsonValue, type RegisteredOperation } from '@lifeboard/node-kit'
import { createShapeId, type Editor } from '@lifeboard/canvas'
import { parse as parseYaml } from 'yaml'
import { holdImport, isTree, treeNodes, treeStatus, working } from '@lifeboard/skill-tree'
import { isItem, isTrack, NOTE_TYPE } from './board'
import { showTrack, tick } from './ops'
import { getItem, getTrack, getTracks, updateItem } from './syllabus'
import { getSkillIndex, getTrackIndex } from './skillIndex'
import { boardGoals, confirmDraft, discardDraft, exportSyllabus, importSyllabus } from './syllabusIO'
import { describeDoc, parseSyllabus } from './syllabusYaml'

/**
 * Getting syllabi in and out (docs/skill-tree-plan.md, step 5): commands for a person, operations
 * (and so MCP tools) for the agent, and `.yaml` files dropped on the board. Every import lands as a
 * draft to look over, then Confirm or Discard on the bar the board shows while it has one (DraftBar.tsx).
 */

const GROUP = 'Syllabus'

/** The vault items behind the selected cards. */
const selectedCards = (editor: Editor): string[] => editor.getSelectedShapes().filter(isItem).map((card) => card.props.itemId)

/**
 * Says what went wrong where the person is looking: a note on the board with the problems listed.
 * There is no toast an extension can reach, and a note can be read at leisure and deleted.
 */
function reportProblems(editor: Editor, title: string, problems: readonly string[]): void {
	const { center } = editor.getViewportPageBounds()
	editor.run(() => {
		editor.markHistoryStoppingPoint('syllabus problems')
		editor.createShape({
			id: createShapeId(),
			type: NOTE_TYPE,
			x: center.x - 160,
			y: center.y - 80,
			props: { md: `# ${title}\n\n${problems.map((p) => `- ${p}`).join('\n')}\n`, autoHeight: true, w: 320 },
		} as never)
	})
}

/** Right of everything on the board, so a draft never lands on top of what is already there. */
function freeSpot(editor: Editor): { x: number; y: number } {
	const bounds = editor.getCurrentPageBounds()
	if (!bounds) return editor.getViewportPageBounds().center
	return { x: bounds.maxX + 400, y: bounds.minY }
}

/**
 * Reads (a document loaded on demand, or text), parses and imports it (at `at`, or in free space),
 * shows the draft, and returns what happened or why not. A big one takes seconds, so the board says
 * which step it is on (progress.ts) and lays the draft out once, at the end.
 */
async function importText(editor: Editor, source: string | (() => Promise<string>), title = 'Importing the syllabus', at?: { x: number; y: number }) {
	const outcome = await working(editor, title, 3, async (step) => {
		await step('Reading the document')
		const parsed = parseSyllabus(typeof source === 'string' ? source : await source())
		if (!parsed.ok) return parsed
		const release = holdImport(editor)
		try {
			await step(`Adding ${describeDoc(parsed.doc)}`)
			const result = importSyllabus(editor, parsed.doc, at ?? freeSpot(editor))
			await step('Laying out the trees')
			release()
			// The tree sync lays the board out in a microtask once the hold ends.
			await Promise.resolve()
			return { ok: true as const, result, summary: describeDoc(parsed.doc) }
		} finally {
			release()
		}
	})
	if (!outcome.ok) return outcome
	const { result } = outcome
	if (result.draftIds.length) {
		editor.setSelectedShapes(result.draftIds)
		const bounds = editor.getSelectionPageBounds()
		if (bounds) editor.zoomToBounds(bounds, { animation: { duration: 250 } })
	}
	return outcome
}

/** The goal of the selected list or tree, if one is selected. */
const selectedGoal = (editor: Editor) =>
	editor
		.getSelectedShapes()
		.flatMap((s) => (isTrack(s) ? [getTrack(s.props.trackId)?.goal ?? ''] : isTree(s) ? [s.props.goal] : []))[0]

/**
 * Confirms this board's draft, saying so on the board while the trees lay out. What the draft bar's
 * Confirm runs (DraftBar.tsx); the agent's operation confirms without the progress note.
 */
export async function confirmImport(editor: Editor): Promise<void> {
	await working(editor, 'Confirming the draft', 2, async (step) => {
		const release = holdImport(editor)
		try {
			await step('Adding it to the vault')
			confirmDraft(editor)
			await step('Laying out the trees')
		} finally {
			release()
		}
		await Promise.resolve()
	})
}

export const syllabusCommands: readonly Command[] = [
	{
		id: 'skill-tree.complete',
		title: 'Complete or reopen item',
		group: GROUP,
		when: (ctx) => !!ctx.editor && selectedCards(ctx.editor).some((id) => getItem(id)?.children.length === 0),
		run: ({ editor }) => {
			if (!editor) return
			for (const card of editor.getSelectedShapes().filter(isItem)) {
				const item = getItem(card.props.itemId)
				if (item && !item.children.length) tick(editor, item.itemId, !item.done, card.id)
			}
		},
	},
	{
		id: 'skill-tree.import-clipboard',
		title: 'Import syllabus YAML from the clipboard',
		group: GROUP,
		when: (ctx) => ctx.editor !== null,
		run: async ({ editor }) => {
			if (!editor) return
			let text = ''
			try {
				text = await navigator.clipboard.readText()
			} catch {
				reportProblems(editor, 'Could not read the clipboard', ['Allow clipboard access, or drop a .yaml file on the board instead.'])
				return
			}
			const outcome = await importText(editor, text)
			if (!outcome.ok) reportProblems(editor, 'Syllabus not imported', outcome.errors)
		},
	},
	{
		id: 'skill-tree.export-clipboard',
		title: 'Copy a syllabus as YAML (the selected track\'s goal, or the first)',
		group: GROUP,
		when: (ctx) => ctx.editor !== null,
		run: async ({ editor }) => {
			if (!editor) return
			try {
				await navigator.clipboard.writeText(exportSyllabus(editor, selectedGoal(editor)))
			} catch {
				reportProblems(editor, 'Could not write to the clipboard', ['Allow clipboard access and try again.'])
			}
		},
	},
]

/** A `.yaml` file dropped on a board is imported as a draft where it was dropped. */
export const syllabusFileImport: FileImport = {
	extensions: ['yaml', 'yml'],
	onFile: async ({ editor, file, point }) => {
		const outcome = await importText(editor, await file.text(), `Importing ${file.name}`, point)
		if (!outcome.ok) reportProblems(editor, `${file.name} not imported`, outcome.errors)
	},
}

const NO_BOARD = 'No board is open. Open a board and try again.'

export const syllabusOperations: readonly RegisteredOperation[] = [
	defineOperation({
		id: 'skill.import',
		title: 'Import a syllabus',
		description: [
			'Puts a syllabus written in the skill-tree YAML format on the open board, as a draft the user confirms or discards.',
			'Top-level keys: goal (short id), name, tracks (each: id, name, state, defaultTags, items), tree (id, name, layout sectors|lineage|free, sectors, rings, nodes).',
			'An item: id, title, kind (Study|Practice|Ship), medium (book, work, play, film, game, album, talk, exercise, artefact, visit), tags (node ids), core, childRule (core|all|a number), children.',
			'A node: id, name, kind (root|skill|method|keystone), icon (a Tabler icon name), sector, ring, requires (a list of { node: [ids] }, { item: id }, { count: { min, kind, medium, method } }).',
			'Ids are short and get the goal as a prefix; an id containing "/" is used as it is. Items whose id is already on the board are updated in place.',
			'Returns what was created and updated, or the problems that stopped the import.',
		].join(' '),
		params: {
			yaml: { type: 'string', description: 'The whole syllabus document, as YAML.', required: true },
		},
		run: async (ctx, args) => {
			if (!ctx.editor) return fail(NO_BOARD)
			const outcome = await importText(ctx.editor, args.yaml)
			if (!outcome.ok) return fail(`Not imported:\n${outcome.errors.join('\n')}`)
			return ok({
				draft: true,
				summary: outcome.summary,
				created: outcome.result.created,
				updated: outcome.result.updated,
				next: 'Ask the user to look the dashed draft over and press Confirm or Discard on the bar at the top of the board.',
			})
		},
	}),
	defineOperation({
		id: 'skill.export',
		title: 'Export the syllabus',
		description:
			"Returns one goal's tracks, items and skill tree from the open board in the skill-tree YAML format, ids in full, and the names of every goal the board holds.",
		params: {
			goal: { type: 'string', description: 'The goal name to export. Optional; defaults to the first goal on the board.' },
		},
		readOnly: true,
		run: async (ctx, args) =>
			ctx.editor ? ok({ yaml: exportSyllabus(ctx.editor, args.goal), goals: boardGoals(ctx.editor) }) : fail(NO_BOARD),
	}),
	defineOperation({
		id: 'skill.item.complete',
		title: 'Complete a syllabus item',
		description:
			'Ticks (or unticks) a syllabus item by its item id. It is vault data, so every board shows the tick; with a board open, its write-up note is filed there from its template. Only items without works can be ticked; an entry is done when its works are.',
		params: {
			itemId: { type: 'string', description: 'The item id, e.g. "adler/011-aristotle/poetics".', required: true },
			done: { type: 'boolean', description: 'False to reopen it. Defaults to true.' },
		},
		run: async (ctx, args) => {
			const item = getItem(args.itemId)
			if (!item) return fail(`No item "${args.itemId}" in the vault.`)
			if (item.children.length) return fail(`"${item.title}" has works; tick those instead.`)
			tick(ctx.editor, item.itemId, args.done !== false)
			return ok({ itemId: args.itemId, done: args.done !== false })
		},
	}),
	defineOperation({
		id: 'skill.tag',
		title: 'Tag syllabus items',
		description:
			'Sets the skill-node tags of many vault items at once, for a bulk tagging pass. Takes a YAML map from item id to a list of node ids; each list replaces that item\'s tags.',
		params: {
			assignments: { type: 'string', description: 'YAML, e.g. "adler/001-homer: [adler/greek-epic-drama]".', required: true },
		},
		run: async (ctx, args) => {
			let map: unknown
			try {
				map = parseYaml(args.assignments)
			} catch (error) {
				return fail(`Not valid YAML: ${error instanceof Error ? error.message : String(error)}`)
			}
			if (!map || typeof map !== 'object' || Array.isArray(map)) return fail('Expected a map from item id to a list of node ids.')
			const missing: string[] = []
			let tagged = 0
			for (const [itemId, tags] of Object.entries(map as Record<string, unknown>)) {
				if (!getItem(itemId)) {
					missing.push(itemId)
					continue
				}
				const list = Array.isArray(tags) ? tags.map(String) : String(tags ?? '').split(',')
				updateItem(itemId, { tags: list.map((t) => t.trim()).filter(Boolean) })
				tagged++
			}
			return ok({ tagged, missing })
		},
	}),
	defineOperation({
		id: 'skill.read',
		title: 'Read syllabus progress',
		description:
			'Returns progress from the vault: tracks with their order, items with done/evidence/tags, and the state of every skill node on the open board (locked, available, unlocked, mastery).',
		params: {
			goal: { type: 'string', description: 'Only this goal (a track goal name). Optional.' },
		},
		readOnly: true,
		run: async (ctx, args) => {
			const goal = args.goal ?? ''
			const tracks = Object.values(getTrackIndex()).filter((t) => !goal || t.goal === goal)
			const index = getSkillIndex()
			const items = Object.values(index).map(({ itemId, title, kind, medium, tags, done, doneAt, evidence, parentItemId }) => ({
				itemId,
				title,
				kind,
				medium,
				tags,
				done,
				doneAt,
				evidence,
				parentItemId,
			}))
			const nodes: JsonValue[] = []
			if (ctx.editor) {
				const treeIds = new Set(ctx.editor.getCurrentPageShapes().flatMap((s) => (s.type === 'node.skill' ? [(s.props as { treeId: string }).treeId] : [])))
				for (const treeId of treeIds) {
					const tree = treeNodes(ctx.editor, treeId)
					const status = treeStatus(ctx.editor, treeId)
					for (const n of tree) {
						const s = status.get(n.props.nodeId)
						nodes.push({
							treeId,
							nodeId: n.props.nodeId,
							name: n.props.name,
							state: s?.state ?? 'locked',
							mastery: s?.mastery.tier ?? 0,
							unmet: s?.conditions.filter((c) => !c.met).map((c) => `${c.label} ${c.have}/${c.need}`) ?? [],
						})
					}
				}
			}
			// The index entries are plain JSON already; the round trip drops undefined fields and satisfies JsonValue.
			return ok(JSON.parse(JSON.stringify({ tracks, items, nodes })) as JsonValue)
		},
	}),
	defineOperation({
		id: 'skill.track.show',
		title: 'Show a track as a list',
		description:
			'Puts a list of a vault track on the open board: the whole outline in reading order, every entry folding to its works, ticking in place. The same track can be listed on any number of boards.',
		params: {
			track: {
				type: 'string',
				description: 'The track id.',
				required: true,
				liveChoices: () => Object.values(getTracks()).filter((t) => !t.draft).map((t) => t.trackId).sort(),
			},
		},
		run: async (ctx, args) => {
			const editor = ctx.editor
			if (!editor) return fail(NO_BOARD)
			const track = getTrack(args.track)
			if (!track) return fail(`No track "${args.track}". Tracks: ${Object.keys(getTracks()).join(', ') || 'none yet'}.`)
			const c = editor.getViewportPageBounds().center
			const id = showTrack(editor, track.trackId, { x: c.x - 190, y: c.y - 280 })
			editor.setSelectedShapes([id])
			return ok({ shown: track.trackId, entries: track.order.length })
		},
	}),
	defineOperation({
		id: 'skill.draft.confirm',
		title: 'Confirm the syllabus draft',
		description: 'Confirms every draft (dashed) syllabus shape on the open board, so it joins the index. Only after the user has said yes.',
		params: {},
		run: async (ctx) => (ctx.editor ? ok({ confirmed: confirmDraft(ctx.editor) }) : fail(NO_BOARD)),
	}),
	defineOperation({
		id: 'skill.draft.discard',
		title: 'Discard the syllabus draft',
		description: 'Deletes every draft (dashed) syllabus shape on the open board.',
		params: {},
		run: async (ctx) => (ctx.editor ? ok({ discarded: discardDraft(ctx.editor) }) : fail(NO_BOARD)),
	}),
]
