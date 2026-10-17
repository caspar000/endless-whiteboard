import { createShapePropsMigrationIds, createShapePropsMigrationSequence, NodeEditorPopover, type NodeComponentProps, type NodeDefinition } from '@lifeboard/node-kit'
import { stopEventPropagation, T, useValue, type Editor } from '@lifeboard/canvas'
import { Network } from 'lucide-react'
import { memo, type KeyboardEvent } from 'react'
import { draftClass, TREE_TYPE, treeNodes, type SkillTreeProps } from '../board'
import { makeItemId } from '../model'
import { TIERS } from '../requirements'
import { treeStatus } from './status'
import { boardTrees, reachFrom, treeGraph } from '../views'

const keepKeys = (e: KeyboardEvent) => e.stopPropagation()

function rootChoices(editor: Editor, treeId: string): { id: string; nodeId: string; name: string }[] {
	const graph = treeGraph(boardTrees(editor))
	const root = graph.rootOf.get(treeId)
	if (!root) return treeNodes(editor, treeId).map((n) => ({ id: n.id, nodeId: n.props.nodeId, name: n.props.name }))
	return [...reachFrom(graph, root)].map((id) => ({ id, nodeId: id, name: graph.nodes.get(id)!.def.name }))
}

const versions = createShapePropsMigrationIds(TREE_TYPE, { AddRoot: 1 })

/**
 * A tree's header card: its name and goal, how much of it is unlocked, and the axes auto-layout
 * places its nodes on (docs/skill-tree-plan.md, "Layout"). The nodes are separate shapes that name
 * this tree by id.
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

	const body = (
		<div className={`lb-skilltree${draftClass(shape as never)}`}>
			<span className="lb-skilltree__name">{shape.props.name || 'Untitled Tree'}</span>
			{shape.props.goal && <span className="lb-skilltree__goal">{shape.props.goal}</span>}
			<span className="lb-skilltree__stats">
				{summary.unlocked}/{summary.total} unlocked · {summary.available} in reach
				{summary.tiers.some(Boolean) &&
					` · ${TIERS.map((name, t) => (summary.tiers[t] ? `${summary.tiers[t]} ${name}` : '')).filter(Boolean).join(', ')}`}
			</span>
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
					<p className="lb-skill-editor__hint">This board shows the tree from that node: it and everything that grows from it, trees mounted on it included. Run "Lay out tree" to place them again.</p>
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
		autoHeight: true,
	}),
	onCreate: ({ shape }) => (shape.props.treeId ? null : { treeId: makeItemId(shape.props.name || 'tree', 'tree/') }),
	defaultSize: { w: 280, h: 72 },
	autoHeight: { minHeight: 72 },
	component: TreeComponent,
	canEdit: true,
	getLabel: (shape) => shape.props.name || undefined,
}
