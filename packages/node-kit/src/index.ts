/**
 * `@lifeboard/node-kit` — the smart-node system.
 *
 * This package is precisely the code that becomes the plugin SDK, gets reused by a future sync
 * server for schema/validation, and ships unchanged into a Tauri build. Nothing in here may reach
 * for the DOM's storage or file APIs — that belongs behind the app's `PlatformAdapter` (§4.5).
 */

// Registers the built-in node types with tldraw's *type* system (see shape-types.ts). Imported for
// its side effect on the module graph — must stay above the value exports.
import './shape-types'

// The load-bearing seam
export {
	clearNodeRegistry,
	createNodeShapeUtil,
	getNodeDefinition,
	getNodeDefinitions,
	isNodeType,
	registerNode,
	updateNodeProps,
	type NodeBaseProps,
	type NodeComponentProps,
	type NodeDefinition,
	type NodeShape,
} from './registry'

export { emptyPropsMigrations } from './migrations'
export { NodeEditorPopover } from './NodeEditorPopover'

// Field & facts contracts
export {
	FIELD_TYPES,
	DEFAULT_CURRENCY,
	coerceFieldValue,
	currencySymbol,
	defaultUnitForType,
	fieldKeyLabel,
	fieldValidator,
	formatCurrency,
	formatFieldValue,
	formatNumber,
	normalizeFieldKey,
	numericFieldValue,
	type FieldType,
	type FieldValue,
	type NodeField,
} from './fields'

export {
	areFactsEqual,
	areFactsMapsEqual,
	collectFieldKeys,
	collectTags,
	dominantUnit,
	type FactsMap,
	type NodeFacts,
} from './facts'

// Node definitions
export { MARKDOWN_NODE_TYPE, markdownNodeDefinition, markdownTitle, type MarkdownNodeProps } from './nodes/markdown/definition'
export { ITEM_NODE_TYPE, itemNodeDefinition, toTemplateFields, type ItemNodeProps } from './nodes/item/definition'
export {
	deleteFieldTemplate,
	readFieldTemplates,
	saveFieldTemplate,
	type FieldTemplate,
} from './nodes/item/templates'
export { ROLLUP_NODE_TYPE, rollupNodeDefinition, type RollupNodeProps } from './nodes/rollup/definition'

// Rollup engine
export {
	AGG_OPS,
	EMPTY_ROLLUP,
	FORMAT_STYLES,
	SOURCE_SCOPES,
	aggregate,
	formatRollupValue,
	type AggOp,
	type FormatStyle,
	type RollupAgg,
	type RollupFormat,
	type RollupResult,
	type RollupRow,
	type RollupSource,
	type SourceScope,
} from './nodes/rollup/aggregate'
export { getPageFacts, getRollupResult, rollupStats } from './nodes/rollup/engine'

import { itemNodeDefinition } from './nodes/item/definition'
import { markdownNodeDefinition } from './nodes/markdown/definition'
import { getNodeDefinition, registerNode, type NodeDefinition } from './registry'
import { rollupNodeDefinition } from './nodes/rollup/definition'

/**
 * Registers the built-in node types.
 *
 * Idempotent, and — importantly — **invoked below at module load**. The registry is the single
 * source of truth for shape utils, tools and toolbar entries, and consumers legitimately read it at
 * their own module scope. ESM guarantees this module finishes evaluating before any importer's body
 * runs, so registering here means the registry is never observed empty. (Requiring the app to call
 * this imperatively was a real bug: `createNodeTools()` ran at import time, saw an empty registry,
 * and the node tools silently never existed while shape utils — read from a separate array — did.)
 *
 * Plugin-supplied definitions will later arrive through the same `registerNode` door.
 */
export function registerBuiltinNodes(): void {
	for (const def of [markdownNodeDefinition, itemNodeDefinition, rollupNodeDefinition]) {
		if (!getNodeDefinition(def.type)) registerNode(def as unknown as NodeDefinition<never>)
	}
}

registerBuiltinNodes()
