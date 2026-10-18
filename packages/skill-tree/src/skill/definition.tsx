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

export const SKILL_SIZE = 150
/** The middle of the tree (the Mastery node, "you"): a large disc, like the class portrait at the middle of Path of Exile's tree. */
export const MASTERY_SIZE = 380

/** A pillar, the root of one area of life: bigger than a skill node, smaller than the middle. */
export const PILLAR_SIZE = 210

/** How big a skill node of this kind is drawn. */
export const sizeOfKind = (kind: string) => (kind === 'mastery' ? MASTERY_SIZE : kind === 'pillar' ? PILLAR_SIZE : SKILL_SIZE)

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
	component: SkillComponent,
	canEdit: true,
	// Double-click, Enter, or right-click › Edit opens its editor.
	getLabel: (shape) => shape.props.name || undefined,
}
