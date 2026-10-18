import type { Editor, TLShapeId } from '@lifeboard/canvas'
import { createShapeId } from '@lifeboard/canvas'
import { HABIT_TYPE } from '../board'
import { todayIso } from '../model'
import { insertTree, type NewSkill } from './ops'

/**
 * A first constellation for the Adler sample: the root, two method perks, and one node per field of
 * the fifteen Greek entries. The sample's items carry these node ids as tags (sample.ts), so ticking
 * and writing up an entry lights its field here, on this board or any other.
 */
const SECTORS = ['literature', 'philosophy', 'science', 'history']
const RINGS = ['method', 'ancient']

const NODES: NewSkill[] = [
	{ nodeId: 'adler/root', icon: 'building-arch', name: 'Literature', kind: 'root' },
	{
		nodeId: 'adler/inspectional', icon: 'zoom-scan',
		name: 'Inspectional Reading',
		kind: 'method',
		sector: 'literature',
		ring: 'method',
		requires: '- node: [adler/root]\n- count: { min: 1, method: analytical }',
	},
	{
		nodeId: 'adler/analytical', icon: 'brain',
		name: 'Analytical Reading',
		kind: 'method',
		sector: 'science',
		ring: 'method',
		requires: '- node: [adler/inspectional]\n- count: { min: 3, method: analytical }',
	},
	{
		nodeId: 'adler/greek-epic-drama', icon: 'masks-theater',
		name: 'Greek Epic and Drama',
		sector: 'literature',
		ring: 'ancient',
		requires: '- node: [adler/root]\n- count: { min: 3 }',
	},
	{
		nodeId: 'adler/greek-philosophy', icon: 'bulb',
		name: 'Greek Philosophy',
		sector: 'philosophy',
		ring: 'ancient',
		requires: '- node: [adler/root]\n- count: { min: 2 }',
	},
	{
		nodeId: 'adler/greek-science', icon: 'math-function',
		name: 'Greek Science and Mathematics',
		sector: 'science',
		ring: 'ancient',
		requires: '- node: [adler/analytical]\n- count: { min: 2 }',
	},
	{
		nodeId: 'adler/reading-habit', icon: 'flame',
		name: 'The Reading Habit',
		kind: 'keystone',
		sector: 'history',
		ring: 'method',
		requires: '- node: [adler/root]\n- habit: { id: adler/weekly-entry, rule: periods, min: 4 }',
	},
	{
		nodeId: 'adler/greek-history', icon: 'history',
		name: 'Greek History',
		sector: 'history',
		ring: 'ancient',
		requires: '- node: [adler/root]\n- count: { min: 2 }',
	},
]

/**
 * Two habits beside the tree: one that counts itself (an entry written up each week, which the
 * keystone above asks four weeks of) and one ticked by hand.
 */
const HABITS = [
	{ habitId: 'adler/weekly-entry', name: 'Write Up an Entry', period: 'week', target: 1, counts: 'method: analytical' },
	{ habitId: 'adler/daily-reading', name: 'Read for 30 Minutes', period: 'day', target: 1, counts: '' },
]

export function insertAdlerTree(editor: Editor, center: { x: number; y: number }): TLShapeId {
	let header!: TLShapeId
	editor.run(() => {
		header = insertTree(
			editor,
			{ treeId: 'adler', name: 'Western Canon Reader', goal: "Adler's reading list", sectors: SECTORS, rings: RINGS, nodes: NODES },
			center
		)
		const at = editor.getShapePageBounds(header)
		HABITS.forEach((habit, i) =>
			editor.createShape({
				id: createShapeId(),
				type: HABIT_TYPE,
				x: (at?.x ?? center.x) + 300,
				y: (at?.y ?? center.y) + i * 100,
				props: { ...habit, goal: 'Western canon reader', startedAt: todayIso(), log: '{}', state: 'active' },
			} as never)
		)
	})
	return header
}
