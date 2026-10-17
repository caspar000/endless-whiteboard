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
import { focusOn } from '../tree/focus'

export const SKILL_SIZE = 110

const versions = createShapePropsMigrationIds(SKILL_TYPE, { AddIcon: 1 })

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
	},
	migrations: createShapePropsMigrationSequence({
		sequence: [
			{
				id: versions.AddIcon,
				up(props) {
					props.icon = ''
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
	}),
	onCreate: ({ shape }) => (shape.props.nodeId ? null : { nodeId: makeItemId(shape.props.name || 'skill') }),
	defaultSize: { w: SKILL_SIZE, h: SKILL_SIZE },
	aspectRatioLocked: true,
	component: SkillComponent,
	canEdit: true,
	// Double-click focuses the tree on the node; Enter, or right-click › Edit, opens its editor.
	onDoubleClick: ({ editor, shape }) => focusOn(editor, (shape.props as SkillNodeProps).nodeId),
	getLabel: (shape) => shape.props.name || undefined,
}
