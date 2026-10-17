import { defineOperation, fail, ok, type Command, type FileImport, type JsonValue, type RegisteredOperation } from '@lifeboard/node-kit'
import { createShapeId, type Editor } from '@lifeboard/canvas'
import { parse as parseYaml } from 'yaml'
import { isDraft, isHabit, isSkill, isTrack, isTree, itemByItemId, NOTE_TYPE, treeNodes, type SkillShape } from './board'
import { formatTags } from './model'
import { setItemDone } from './ops'
import { evaluateTree } from './requirements'
import { getHabitIndex, getSkillIndex, getTrackIndex } from './skillIndex'
import { gatherAroundMastery, layoutFrom, layoutTree, treeHeader } from './tree/ops'
import { getTreeDef, getTreeDefs, updateTreeMeta } from './treeDefs'
import { treeGraph } from './views'
import { boardGoals, confirmDraft, discardDraft, exportSyllabus, importSyllabus } from './syllabusIO'
import { describeDoc, parseSyllabus } from './syllabusYaml'

/**
 * Getting syllabi in and out (docs/skill-tree-plan.md, step 5): commands for a person, operations
 * (and so MCP tools) for the agent, and `.yaml` files dropped on the board. Every import lands as a
 * draft to look over, then "Confirm draft" or "Discard draft".
 */

const GROUP = 'Syllabus'

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

/** Parses and imports (at `at`, or in free space), shows the draft, and returns what happened or why not. */
function importText(editor: Editor, text: string, at?: { x: number; y: number }) {
	const parsed = parseSyllabus(text)
	if (!parsed.ok) return parsed
	const result = importSyllabus(editor, parsed.doc, at ?? freeSpot(editor))
	if (result.draftIds.length) {
		editor.setSelectedShapes(result.draftIds)
		const bounds = editor.getSelectionPageBounds()
		if (bounds) editor.zoomToBounds(bounds, { animation: { duration: 250 } })
	}
	return { ok: true as const, result, summary: describeDoc(parsed.doc) }
}

/** The goal of the selected track, tree or habit, if one is selected. */
const selectedGoal = (editor: Editor) =>
	editor.getSelectedShapes().flatMap((s) => (isTrack(s) || isTree(s) || isHabit(s) ? [s.props.goal] : []))[0]

const hasDraft = (editor: Editor | null) => !!editor && editor.getCurrentPageShapes().some(isDraft)

export const syllabusCommands: readonly Command[] = [
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
			const outcome = importText(editor, text)
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
	{
		id: 'skill-tree.import-adler',
		title: "Import Adler's full reading list (137 entries)",
		group: GROUP,
		when: (ctx) => ctx.editor !== null,
		run: async ({ editor }) => {
			if (!editor) return
			// Loaded on demand: the document is sixty kilobytes the board never needs otherwise.
			const { default: text } = await import('../content/adler.yaml?raw')
			const outcome = importText(editor, text)
			if (!outcome.ok) reportProblems(editor, "Adler's list not imported", outcome.errors)
		},
	},
	{
		id: 'skill-tree.confirm-draft',
		title: 'Confirm draft',
		group: GROUP,
		when: (ctx) => hasDraft(ctx.editor),
		run: ({ editor }) => {
			if (editor) confirmDraft(editor)
		},
	},
	{
		id: 'skill-tree.discard-draft',
		title: 'Discard draft',
		group: GROUP,
		when: (ctx) => hasDraft(ctx.editor),
		run: ({ editor }) => {
			if (editor) discardDraft(editor)
		},
	},
]

/** A `.yaml` file dropped on a board is imported as a draft where it was dropped. */
export const syllabusFileImport: FileImport = {
	extensions: ['yaml', 'yml'],
	onFile: async ({ editor, file, point }) => {
		const outcome = importText(editor, await file.text(), point)
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
			'Top-level keys: goal (short id), name, tracks (each: id, name, state, defaultTags, items), tree (id, name, layout sectors|lineage|free, sectors, rings, nodes), habits.',
			'An item: id, title, kind (Study|Practice|Ship), medium (book, work, play, film, game, album, talk, exercise, artefact, visit), tags (node ids), core, childRule (core|all|a number), children.',
			'A node: id, name, kind (root|skill|method|keystone), icon (a Tabler icon name), sector, ring, requires (a list of { node: [ids] }, { item: id }, { count: { min, kind, medium, method } }, { habit: { id, rule: total|streak|best_week|periods, min } }).',
			'A habit: id, name, period (day|week|month), target, counts (a map of kind/medium/method/tag, or empty to tick by hand), startedBy (an item id).',
			'Ids are short and get the goal as a prefix; an id containing "/" is used as it is. Items whose id is already on the board are updated in place.',
			'Returns what was created and updated, or the problems that stopped the import.',
		].join(' '),
		params: {
			yaml: { type: 'string', description: 'The whole syllabus document, as YAML.', required: true },
		},
		run: async (ctx, args) => {
			if (!ctx.editor) return fail(NO_BOARD)
			const outcome = importText(ctx.editor, args.yaml)
			if (!outcome.ok) return fail(`Not imported:\n${outcome.errors.join('\n')}`)
			return ok({
				draft: true,
				summary: outcome.summary,
				created: outcome.result.created,
				updated: outcome.result.updated,
				next: 'Ask the user to look the dashed draft over and run "Confirm draft" or "Discard draft".',
			})
		},
	}),
	defineOperation({
		id: 'skill.export',
		title: 'Export the syllabus',
		description:
			"Returns one goal's tracks, items, skill tree and habits from the open board in the skill-tree YAML format, ids in full, and the names of every goal the board holds.",
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
		description: 'Ticks (or unticks) a syllabus item on the open board by its item id, filing its evidence note from the template. Only items without children can be ticked.',
		params: {
			itemId: { type: 'string', description: 'The item id, e.g. "adler/011-aristotle/poetics".', required: true },
			done: { type: 'boolean', description: 'False to reopen it. Defaults to true.' },
		},
		run: async (ctx, args) => {
			if (!ctx.editor) return fail(NO_BOARD)
			const item = itemByItemId(ctx.editor, args.itemId)
			if (!item) return fail(`No item "${args.itemId}" on this board.`)
			setItemDone(ctx.editor, item.id, args.done !== false)
			return ok({ itemId: args.itemId, done: args.done !== false })
		},
	}),
	defineOperation({
		id: 'skill.tag',
		title: 'Tag syllabus items',
		description:
			'Sets the skill-node tags of many items on the open board at once, for a bulk tagging pass. Takes a YAML map from item id to a list of node ids; each list replaces that item\'s tags.',
		params: {
			assignments: { type: 'string', description: 'YAML, e.g. "adler/001-homer: [adler/greek-epic-drama]".', required: true },
		},
		run: async (ctx, args) => {
			const editor = ctx.editor
			if (!editor) return fail(NO_BOARD)
			let map: unknown
			try {
				map = parseYaml(args.assignments)
			} catch (error) {
				return fail(`Not valid YAML: ${error instanceof Error ? error.message : String(error)}`)
			}
			if (!map || typeof map !== 'object' || Array.isArray(map)) return fail('Expected a map from item id to a list of node ids.')
			const missing: string[] = []
			let tagged = 0
			editor.run(() => {
				editor.markHistoryStoppingPoint('tag items')
				for (const [itemId, tags] of Object.entries(map as Record<string, unknown>)) {
					const item = itemByItemId(editor, itemId)
					if (!item) {
						missing.push(itemId)
						continue
					}
					const list = Array.isArray(tags) ? tags.map(String) : String(tags ?? '').split(',')
					editor.updateShape({ id: item.id, type: item.type, props: { tags: formatTags(list) } } as never)
					tagged++
				}
			})
			return ok({ tagged, missing })
		},
	}),
	defineOperation({
		id: 'skill.read',
		title: 'Read syllabus progress',
		description:
			'Returns progress across every board: tracks with their order, items with done/evidence/tags, habits, and the state of every skill node on the open board (locked, available, unlocked, mastery).',
		params: {
			goal: { type: 'string', description: 'Only this goal (a track or habit goal name). Optional.' },
		},
		readOnly: true,
		run: async (ctx, args) => {
			const goal = args.goal ?? ''
			const tracks = Object.values(getTrackIndex()).filter((t) => !goal || t.goal === goal)
			const habits = Object.values(getHabitIndex()).filter((h) => !goal || h.goal === goal)
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
					const status = evaluateTree(
						tree.map((n) => ({ nodeId: n.props.nodeId, name: n.props.name, requires: n.props.requires, kind: n.props.kind })),
						index,
						getHabitIndex()
					)
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
			return ok(JSON.parse(JSON.stringify({ tracks, items, habits, nodes })) as JsonValue)
		},
	}),
	defineOperation({
		id: 'skill.tree.layout',
		title: 'Lay out a skill tree',
		description:
			'Places a skill tree on the open board so no nodes overlap and no line runs through a node: the tree from its root, one node and everything depending on it, or every tree around a Mastery node. One undo step.',
		params: {
			treeId: { type: 'string', description: 'The tree to lay out, e.g. "adler". Leave empty with mastery set.' },
			from: { type: 'string', description: 'A node id: lay out only it and what depends on it, around where it stands.' },
			mastery: { type: 'boolean', description: 'True to gather every tree on the board around a Mastery node (made if missing).' },
		},
		run: async (ctx, args) => {
			const editor = ctx.editor
			if (!editor) return fail(NO_BOARD)
			if (args.mastery) return ok({ moved: gatherAroundMastery(editor) })
			if (args.from) {
				const node = editor.getCurrentPageShapes().find((s): s is SkillShape => isSkill(s) && s.props.nodeId === args.from)
				return node ? ok({ moved: layoutFrom(editor, node) }) : fail(`No node "${args.from}" on this board.`)
			}
			if (!args.treeId) return fail('Name a treeId, a from node, or set mastery.')
			const moved = layoutTree(editor, args.treeId)
			return moved ? ok({ moved }) : fail(`No tree "${args.treeId}" on this board.`)
		},
	}),
	defineOperation({
		id: 'skill.tree.show',
		title: 'Show a skill tree on this board',
		description:
			'Puts a view of a skill tree from the vault on the open board: a header and the nodes it reaches from its root (or from the node given), laid out, trees mounted on them included. The same tree can be shown on any number of boards, each from its own root; edits on any of them change the one tree.',
		params: {
			tree: { type: 'string', description: 'The tree id.', required: true, liveChoices: () => Object.keys(getTreeDefs()).sort() },
			root: { type: 'string', description: 'A node id to show the tree from (that node and what grows from it). Optional.' },
		},
		run: async (ctx, args) => {
			const editor = ctx.editor
			if (!editor) return fail(NO_BOARD)
			const def = getTreeDef(args.tree)
			if (!def) return fail(`No tree "${args.tree}". Trees: ${Object.keys(getTreeDefs()).join(', ') || 'none yet'}.`)
			if (args.root && !treeGraph(getTreeDefs()).nodes.has(args.root)) return fail(`No node "${args.root}" in the vault.`)
			if (treeHeader(editor, args.tree)) return fail(`This board already shows "${def.name || args.tree}". Change its root in the header's editor instead.`)
			const c = editor.getViewportPageBounds().center
			editor.run(() => {
				editor.markHistoryStoppingPoint('show skill tree')
				editor.createShape({
					id: createShapeId(),
					type: 'node.skillTree',
					x: c.x - 140,
					y: c.y - 300,
					props: { treeId: def.treeId, name: def.name, goal: def.goal, sectors: def.sectors, rings: def.rings, root: args.root ?? '' },
				} as never)
			})
			// The board fills the view in after the change (treeSync.ts); give it that turn.
			await new Promise((resolve) => setTimeout(resolve, 0))
			return ok({ shown: def.treeId, nodes: editor.getCurrentPageShapes().filter((s) => isSkill(s)).length })
		},
	}),
	defineOperation({
		id: 'skill.tree.mount',
		title: 'Hang a skill tree from a node',
		description:
			'Mounts a tree on a node of another tree (a pillar, Mastery), so any view of that node shows the tree as its branch. Empty "on" takes the mount away. Vault data: it changes every board.',
		params: {
			tree: { type: 'string', description: 'The tree to hang.', required: true, liveChoices: () => Object.keys(getTreeDefs()).sort() },
			on: { type: 'string', description: 'The node id to hang it from, e.g. "mastery/mental". Empty to unmount.' },
		},
		run: async (_ctx, args) => {
			if (!getTreeDef(args.tree)) return fail(`No tree "${args.tree}".`)
			const graph = treeGraph(getTreeDefs())
			const on = args.on ?? ''
			if (on && !graph.nodes.has(on)) return fail(`No node "${on}" in the vault.`)
			if (on && graph.nodes.get(on)!.treeId === args.tree) return fail('A tree cannot hang from one of its own nodes.')
			updateTreeMeta(args.tree, { mount: on })
			return ok({ tree: args.tree, mount: on })
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

