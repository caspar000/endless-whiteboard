import { createShapePropsMigrationIds, createShapePropsMigrationSequence, NodeEditorPopover, type NodeComponentProps, type NodeDefinition } from '@lifeboard/node-kit'
import { stopEventPropagation, T, useValue, type Editor } from '@lifeboard/canvas'
import { Network } from 'lucide-react'
import { memo, type KeyboardEvent, type SyntheticEvent } from 'react'
import { draftClass, TREE_TYPE, treeNodes, type SkillTreeProps, type TreeShape } from '../board'
import { getItem } from '../syllabus'
import { setView } from './view'
import { recalculate } from './viewSync'
import { makeItemId } from '../model'
import { TIERS } from '../requirements'
import { treeStatus } from './status'
import { boardTrees, reachFrom, treeGraph } from '../views'

const keepKeys = (e: KeyboardEvent) => e.stopPropagation()
const swallow = (e: SyntheticEvent) => e.stopPropagation()

function rootChoices(editor: Editor, treeId: string): { id: string; nodeId: string; name: string }[] {
	const graph = treeGraph(boardTrees(editor))
	const root = graph.rootOf.get(treeId)
	if (!root) return treeNodes(editor, treeId).map((n) => ({ id: n.id, nodeId: n.props.nodeId, name: n.props.name }))
	return [...reachFrom(graph, root)].map((id) => ({ id, nodeId: id, name: graph.nodes.get(id)!.def.name }))
}

const versions = createShapePropsMigrationIds(TREE_TYPE, { AddRoot: 1, AddView: 2, DropFocus: 3 })


/**
 * A tree's header card, and this board's view of the tree (docs/skill-tree-plan.md, "Rebuild"): its
 * name and goal, how much of it is unlocked, which arrangement the board shows, and the buttons that
 * switch it. The nodes are separate shapes the view puts on the board.
 */
function TreeComponentImpl({ shape, isEditing, editor }: NodeComponentProps<SkillTreeProps>) {
	const summary = useValue(
		'lifeboard:skill-tree-summary',
		() => {
			const statuses = [...treeStatus(editor, shape.props.treeId).values()]
			return {
				total: statuses.length,
				unlocked: statuses.filter((s) => s.state === 'unlocked').length,
				available: statuses.filter((s) => s.state === 'available').length,
				tiers: TIERS.map((_, t) => statuses.filter((s) => s.mastery.tier === t + 1).length),
			}
		},
		[editor, shape.props.treeId]
	)

	// Any node the tree reaches can be the view's root, including those of trees mounted on it.
	const nodes = isEditing ? rootChoices(editor, shape.props.treeId) : []
	const set = (props: Partial<SkillTreeProps>) => editor.updateShape({ id: shape.id, type: TREE_TYPE, props } as never)

	const header = shape as unknown as TreeShape
	const mode = shape.props.mode
	const button = (label: string, title: string, run: () => void) => (
		<button
			type="button"
			className="lb-skilltree__button"
			title={title}
			onPointerDown={swallow}
			onClick={(e) => {
				e.stopPropagation()
				run()
			}}
		>
			{label}
		</button>
	)
	const body = (
		<div className={`lb-skilltree${draftClass(shape as never)}`}>
			<span className="lb-skilltree__name">{shape.props.name || 'Untitled Tree'}</span>
			{shape.props.goal && <span className="lb-skilltree__goal">{shape.props.goal}</span>}
			<span className="lb-skilltree__stats">
				{summary.unlocked}/{summary.total} unlocked · {summary.available} in reach
				{summary.tiers.some(Boolean) &&
					` · ${TIERS.map((name, t) => (summary.tiers[t] ? `${summary.tiers[t]} ${name}` : '')).filter(Boolean).join(', ')}`}
			</span>
			<div className="lb-skilltree__bar">
				<span className="lb-skilltree__mode">{mode === 'all' ? 'Everything' : 'Skill nodes'}</span>
				{mode !== 'all' && button('Show all', 'Every entry and work of this tree, however many', () => setView(editor, header, 'all'))}
				{mode !== 'overview' && button('Back', 'Back to the skill nodes', () => setView(editor, header, 'overview'))}
				{button('Re-calculate', 'Lay this arrangement out again from scratch', () => recalculate(editor, header))}
			</div>
		</div>
	)

	if (!isEditing) return body
	return (
		<div onPointerDown={stopEventPropagation} onTouchStart={stopEventPropagation} style={{ pointerEvents: 'all' }}>
			{body}
			<NodeEditorPopover shape={shape} editor={editor} width={300}>
				<div className="lb-skill-editor">
					<label>
						<span>Name</span>
						<input autoFocus value={shape.props.name} onKeyDown={keepKeys} onChange={(e) => set({ name: e.target.value })} />
					</label>
					<label>
						<span>Goal</span>
						<input value={shape.props.goal} onKeyDown={keepKeys} onChange={(e) => set({ goal: e.target.value })} />
					</label>
					<label>
						<span>Show from</span>
						<select value={shape.props.root} onChange={(e) => set({ root: e.target.value })}>
							<option value="">Its root node</option>
							{nodes.map((n) => (
								<option key={n.id} value={n.nodeId}>
									{n.name || n.nodeId}
								</option>
							))}
						</select>
					</label>
					<label>
						<span>Sectors</span>
						<input value={shape.props.sectors} placeholder="comma-separated, in fan order" onKeyDown={keepKeys} onChange={(e) => set({ sectors: e.target.value })} />
					</label>
					<label>
						<span>Rings</span>
						<input value={shape.props.rings} placeholder="inner to outer" onKeyDown={keepKeys} onChange={(e) => set({ rings: e.target.value })} />
					</label>
					<div className="lb-skill-editor__pair">
						<label>
							<span>Live physics</span>
							<select value={shape.props.live} onChange={(e) => set({ live: e.target.value })}>
								<option value="">Default</option>
								<option value="on">On</option>
								<option value="off">Off</option>
							</select>
						</label>
					</div>
					<p className="lb-skill-editor__hint">This board shows the tree from that node: it and everything that grows from it, trees mounted on it included. Re-calculate lays the view out again.</p>
					<p className="lb-skill-editor__id">{shape.props.treeId}</p>
				</div>
			</NodeEditorPopover>
		</div>
	)
}

const TreeComponent = memo(TreeComponentImpl, (prev, next) => prev.shape === next.shape && prev.isEditing === next.isEditing)

export const treeNodeDefinition: NodeDefinition<SkillTreeProps> = {
	type: TREE_TYPE,
	label: 'Skill tree',
	icon: '❖',
	toolbarIcon: Network,
	props: {
		treeId: T.string,
		name: T.string,
		goal: T.string,
		layout: T.string,
		sectors: T.string,
		rings: T.string,
		root: T.string,
		mode: T.string,
		live: T.string,
		places: T.string,
		autoHeight: T.boolean,
	},
	migrations: createShapePropsMigrationSequence({
		sequence: [
			{
				id: versions.AddRoot,
				up(props) {
					props.root = ''
				},
			},
			{
				// A header became the board's view of its tree: what it shows, and where things were.
				id: versions.AddView,
				up(props) {
					props.mode = 'overview'
					props.focus = ''
					props.depth = -1
					props.live = ''
					props.places = '{}'
				},
			},
			{
				// Focus mode went (docs/skill-tree-layout-plan.md, "Views"): a focused view shows everything.
				id: versions.DropFocus,
				up(props) {
					if (props.mode === 'focus') props.mode = 'all'
					delete props.focus
					delete props.depth
				},
			},
		],
	}),
	defaultProps: () => ({
		treeId: '',
		name: 'New Tree',
		goal: '',
		layout: 'sectors',
		sectors: '',
		rings: '',
		root: '',
		mode: 'all',
		live: '',
		places: '{}',
		autoHeight: true,
	}),
	onCreate: ({ shape }) => (shape.props.treeId ? null : { treeId: makeItemId(shape.props.name || 'tree', 'tree/') }),
	defaultSize: { w: 280, h: 72 },
	autoHeight: { minHeight: 72 },
	component: TreeComponent,
	canEdit: true,
	getLabel: (shape) => shape.props.name || undefined,
}
