/**
 * `@lifeboard/skill-tree`: skill trees (docs/skill-tree-plan.md), and the door other extensions add
 * to them through (sources.ts).
 *
 * Reaches the host only through `@lifeboard/node-kit`'s public barrel, like every extension.
 */

// Registers the node types with tldraw's type system. Side-effect import, kept above the exports.
import './shape-types'

export { skillTreeExtension, SKILL_TREE_EXTENSION } from './extension'
export {
	DRAFT_META,
	draftClass,
	ENTRY_TYPE,
	isDraft,
	isEntry,
	isSkill,
	isTree,
	SKILL_TYPE,
	TREE_TYPE,
	treeNodes,
	type EntryProps,
	type EntryShape,
	type SkillNodeProps,
	type SkillShape,
	type SkillTreeProps,
	type TreeShape,
} from './board'
export {
	registerTreeSource,
	type ConditionStatus,
	type Evidence,
	type RequirementContext,
	type RequirementKind,
	type TreeItem,
	type TreeItemLook,
	type TreeSource,
} from './sources'
export { evaluateTree, masteryOf, parseRequirements, type Condition, type NodeStatus, type TreeNode } from './requirements'
export { prerequisitesOf } from './tree/prerequisites'
export { treeStatus } from './tree/status'
export { getTreeDef, getTreeDefs, replaceTreeDefs, setTreeDefsPersistence, updateTreeMeta, type NodeDef, type TreeDef, type TreeDefs } from './treeDefs'
export { firstTreeId, isMap, list, parseTrees, qualify, slug, text, type DocNode, type DocTree } from './treeYaml'
export { boardHasTreeDraft, confirmTrees, discardTrees, importTrees, treeDoc, treeGoals, treePrefix } from './treeIO'
export { syncBoard } from './treeSync'
export { holdImport, isImporting, onImportEnd, whileImporting } from './importing'
export { working } from './progress'
export { makeItemId, todayIso } from './ids'
export { isAutomated, isDevBuild } from './env'
export { entryNodeDefinition } from './entry/definition'
export { skillNodeDefinition } from './skill/definition'
export { treeNodeDefinition } from './tree/definition'
