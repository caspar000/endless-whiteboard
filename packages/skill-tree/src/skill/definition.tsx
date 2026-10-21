import {
	createShapePropsMigrationIds,
	createShapePropsMigrationSequence,
	type NodeDefinition,
} from '@lifeboard/node-kit'
import { T } from '@lifeboard/canvas'
import { Sparkle } from 'lucide-react'
import { SKILL_TYPE, type SkillNodeProps } from '../board'
import { makeItemId } from '../model'
import { SkillComponent } from './SkillComponent'
import { getLayoutConfig } from '../tree/layoutConfig'

export const SKILL_SIZE = 150
/**
 * How big a skill node of this kind is drawn: the middle of the tree ("you") large, like the class
 * portrait at the middle of Path of Exile's tree; a pillar, the root of one area of life, bigger than
 * a skill node. From the layout settings (tree/layoutConfig.ts).
 */
export function sizeOfKind(kind: string): number {
	const c = getLayoutConfig()
	return Math.max(1, kind === 'mastery' ? c.masterySize : kind === 'pillar' ? c.pillarSize : c.skillSize)
}

const versions = createShapePropsMigrationIds(SKILL_TYPE, { AddIcon: 1, AddPicture: 2 })

/** One perk on a skill tree (docs/skill-tree-plan.md, "Trees and skill nodes"). */
export const skillNodeDefinition: NodeDefinition<SkillNodeProps> = {
	type: SKILL_TYPE,
	label: 'Skill node',
	icon: '✦',
	toolbarIcon: Sparkle,
	props: {
		nodeId: T.string,
		treeId: T.string,
		name: T.string,
		kind: T.string,
		sector: T.string,
		ring: T.string,
		requires: T.string,
		icon: T.string,
		picture: T.string,
	},
	migrations: createShapePropsMigrationSequence({
		sequence: [
			{
				id: versions.AddIcon,
				up(props) {
					props.icon = ''
				},
			},
			{
				id: versions.AddPicture,
				up(props) {
					props.picture = ''
				},
			},
		],
	}),
	defaultProps: () => ({
		nodeId: '',
		treeId: '',
		name: '',
		kind: 'skill',
		sector: '',
		ring: '',
		requires: '',
		icon: '',
		picture: '',
	}),
	onCreate: ({ shape }) => (shape.props.nodeId ? null : { nodeId: makeItemId(shape.props.name || 'skill') }),
	defaultSize: { w: SKILL_SIZE, h: SKILL_SIZE },
	aspectRatioLocked: true,
	// A disc: arrows end on its circle, the same distance from its middle whichever way they come in.
	outline: (shape) => ({ cx: shape.props.w / 2, cy: shape.props.h / 2, r: Math.min(shape.props.w, shape.props.h) / 2 }),
	// The maze is a locked structure: dragging a skill node leaves it where the layout put it.
	pinned: true,
	component: SkillComponent,
	canEdit: true,
	gpu: true,
	// Double-click, Enter, or right-click › Edit opens its editor.
	getLabel: (shape) => shape.props.name || undefined,
}
