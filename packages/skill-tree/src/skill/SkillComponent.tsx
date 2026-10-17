import { getIconBridge, NodeEditorPopover, type NodeComponentProps } from '@lifeboard/node-kit'
import { stopEventPropagation, useValue } from '@lifeboard/canvas'
import { memo } from 'react'
import type { SkillNodeProps, SkillShape } from '../board'
import { conditionFraction, TIER_AT, TIERS, type NodeStatus } from '../requirements'
import { treeStatus } from '../tree/status'
import { SkillEditor } from './SkillEditor'

const RING = 2 * Math.PI * 44

/**
 * A skill on the tree: a disc whose ring shows how far its requirement is met while it is available,
 * and how far toward the next mastery tier once it is unlocked (docs/skill-tree-plan.md, "States").
 */
function SkillComponentImpl({ shape, isEditing, editor }: NodeComponentProps<SkillNodeProps>) {
	const skill = shape as unknown as SkillShape
	const status = useValue(
		'lifeboard:skill-status',
		() => treeStatus(editor, shape.props.treeId).get(shape.props.nodeId) ?? null,
		[editor, shape.props.treeId, shape.props.nodeId]
	)
	const state = status?.state ?? 'locked'
	const { fraction, caption } = ringFor(status)
	const tier = status?.mastery.tier ?? 0
	const { Icon } = getIconBridge()

	const body = (
		<div className={`lb-skillnode lb-skillnode--${state} lb-skillnode--${shape.props.kind}${tier ? ` lb-skillnode--tier${tier}` : ''}`}>
			<svg className="lb-skillnode__ring" viewBox="0 0 100 100" aria-hidden>
				<circle className="lb-skillnode__track" cx="50" cy="50" r="44" />
				<circle
					className="lb-skillnode__fill"
					cx="50"
					cy="50"
					r="44"
					strokeDasharray={`${RING * fraction} ${RING}`}
					transform="rotate(-90 50 50)"
				/>
			</svg>
			<div className="lb-skillnode__disc">
				{shape.props.icon && (
					<span className="lb-skillnode__icon">
						<Icon name={shape.props.icon} size={26} />
					</span>
				)}
				<span className="lb-skillnode__name">{shape.props.name || 'Unnamed skill'}</span>
				<span className="lb-skillnode__caption">{caption}</span>
			</div>
		</div>
	)

	if (!isEditing) return body

	return (
		<div onPointerDown={stopEventPropagation} onTouchStart={stopEventPropagation} style={{ pointerEvents: 'all' }}>
			{body}
			<NodeEditorPopover shape={shape} editor={editor} width={320}>
				<SkillEditor skill={skill} editor={editor} status={status} />
			</NodeEditorPopover>
		</div>
	)
}

function ringFor(status: NodeStatus | null): { fraction: number; caption: string } {
	if (!status) return { fraction: 0, caption: 'Locked' }
	if (status.state === 'locked') return { fraction: 0, caption: 'Locked' }
	if (status.state === 'available') {
		const unmet = status.conditions.find((c) => !c.met)
		return { fraction: conditionFraction(status), caption: unmet ? `${unmet.have}/${unmet.need}` : '' }
	}
	const { count, tier, nextAt, ships } = status.mastery
	if (nextAt === null) return { fraction: 1, caption: `${TIERS[2]} · ${count}` }
	const reached = tier === 0 ? 'Unlocked' : TIERS[tier - 1]
	// Enough evidence for the next tier, but every tier also asks for one more made thing.
	if (count >= nextAt && ships < tier + 1) return { fraction: 1, caption: `${reached} · needs a Ship` }
	const from = tier === 0 ? 0 : TIER_AT[tier - 1]!
	return {
		fraction: Math.min(1, (count - from) / (nextAt - from)),
		caption: `${reached} · ${count}/${nextAt}`,
	}
}

export const SkillComponent = memo(
	SkillComponentImpl,
	(prev, next) => prev.shape === next.shape && prev.isEditing === next.isEditing
)
