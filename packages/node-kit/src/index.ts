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
	getDisabledExtensionIds,
	getDisabledExtensions,
	getNodeDefinition,
	getNodeDefinitions,
	getNodeOwner,
	getNodeTypesVersion,
	getVisibleNodeDefinitions,
	hasStripsBelow,
	isExtensionEnabled,
	isNodeType,
	isNodeTypeEnabled,
	registerNode,
	setDisabledExtensionIds,
	setExtensionEnabled,
	subscribeToNodeDefinitions,
	updateNodeProps,
	type NodeBaseProps,
	type NodeComponentProps,
	type NodeDefinition,
	type NodeShape,
	type NodeToolbarIcon,
} from './registry'

// Commands: the second load-bearing seam. One table of user-invokable actions that every command
// surface — the ⌘K palette first; Help, keymaps, generated overrides later — reads as a view.
export {
	clearCommandRegistry,
	getCommand,
	getCommands,
	getVisibleCommands,
	registerCommand,
	subscribeToCommands,
	type Command,
	type CommandContext,
	type CommandView,
} from './commands'

// Operations: the third load-bearing seam. Commands are buttons; operations take named arguments and
// return an answer, which is what a caller that isn't a person at a keyboard needs. The MCP server is
// their first consumer. See `operations.ts` for why this is a sibling table rather than a wider Command.
export {
	clearOperationRegistry,
	coerceArgs,
	commandFromOperation,
	createOperationContext,
	defineOperation,
	fail,
	getOperation,
	getOperations,
	getVisibleOperations,
	ok,
	operationManifest,
	registerOperation,
	registerOperationAsCommand,
	runOperation,
	subscribeToOperations,
	toJsonSchema,
	type Args,
	type CoercedArgs,
	type JsonSchemaObject,
	type JsonSchemaProperty,
	type JsonValue,
	type Operation,
	type OperationContext,
	type OperationManifestEntry,
	type OperationResult,
	type ParamSpec,
	type ParamType,
	type Params,
	type RegisteredOperation,
} from './operations'

// The core operation surface. Registered by the host's composition root, because these need a
// `BoardBridge` installed to do anything.
export { coreOperations, registerCoreOperations } from './ops'
export { createNodeShape, textPropFor } from './nodes/insert'

// The board-capability seam operations run against — installed by the app, like the other bridges.
export {
	clearBoardBridge,
	getBoardBridge,
	setBoardBridge,
	type BoardBridge,
	type BoardSummary,
} from './boardBridge'

// Extensions: the unit the app composes at startup, users toggle in Settings, and plugins ship as.
export {
	actionsForShape,
	clearExtensionRegistry,
	defineNode,
	fileImportFor,
	getExtension,
	getExtensions,
	registerExtension,
	type Extension,
	type FileImport,
	type FileImportContext,
	type ShapeAction,
} from './extensions'

// The outbound-request seam for extensions that reach the outside world — implemented by the app.
export { getNetworkBridge, setNetworkBridge, type NetworkBridge } from './network'

// The storage seam for extensions that own binary content — implemented by the app (§4.5).
export {
	getAssetBridge,
	setAssetBridge,
	useAssetUrl,
	type AssetBridge,
} from './assets'

export {
	createShapePropsMigrationIds,
	createShapePropsMigrationSequence,
	emptyPropsMigrations,
} from './migrations'
export { NodeEditorPopover } from './NodeEditorPopover'
// The one way a node hosts its property/collection strips — see the component's doc comment.
export { NodeStrips } from './NodeStrips'

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
	areValueRecordsEqual,
	collectPropertyIds,
	collectValuesForProperty,
	isEmptyValue,
	listValuesOf,
	type FactsMap,
	type ShapeFacts,
} from './facts'

// The property system: definitions per board, values per shape. Any shape may carry any property.
export {
	PROPERTY_TYPES,
	RATING_MAX,
	STAGE_LABELS,
	STATUS_STAGES,
	defaultUnitForType as defaultUnitForPropertyType,
	emptyValueForType,
	isChoiceType,
	isListType,
	isNumericType,
	nameFromPropertyKey,
	propertyDefValidator,
	propertyIdFromName,
	propertyValueValidator,
	TAGS_PROPERTY_ID,
	type PropertyDef,
	type PropertyType,
	type PropertyValue,
	type StatusStage,
} from './properties/types'
/**
 * Option colouring. Exported because the *help page* renders mock cards and has to paint their chips
 * the same colour the real card would — a help page that invents its own palette is a help page that
 * stops matching the app the first time this hash changes. And because anything drawing an option
 * *outside* a chip — a highlight painted into a book, say — has to match it for the same reason.
 */
export { choiceStyle, optionHue, optionStyle, stageForOption, stageStyle } from './properties/options'
export {
	coercePropertyValue,
	formatPropertyValue,
	groupKeysForValue,
	numericPropertyValue,
} from './properties/format'
export {
	convertAmount,
	currenciesUsed,
	getCurrentRates,
	mergeRates,
	normaliseCurrency,
	rateBetween,
	setCurrentRates,
	type ManualRates,
	type RateTable,
} from './properties/rates'
export {
	createProperty,
	syncPropertyOptions,
	deleteProperty,
	findProperty,
	mergeProperties,
	parsePropertyRegistry,
	propertyMap,
	readPropertyRegistry,
	updateProperty,
} from './properties/schema'
export {
	attachProperty,
	orderedPropertyIds,
	readHiddenPropertyIds,
	readShapeProperties,
	readShapePropertyDefs,
	readShapePropertyUnits,
	removeShapeProperty,
	setShapePropertyHidden,
	setShapePropertyOrder,
	setShapePropertyUnit,
	shapeCarriesProperty,
	unitForShapeProperty,
	updateShapeProperties,
	type ShapeProperties,
	type ShapePropertyUnits,
} from './properties/values'

// Node definitions. The markdown note lives in `@lifeboard/note-markdown` — the first extracted
// extension package; item and rollup stay here as deprecated, schema-only legacy types.
export {
	ITEM_NODE_TYPE,
	itemNodeDefinition,
	toTemplateFields,
	type ItemNodeProps,
} from './nodes/item/definition'
export {
	deleteFieldTemplate,
	readFieldTemplates,
	saveFieldTemplate,
	type FieldTemplate,
} from './nodes/item/templates'
export {
	ROLLUP_NODE_TYPE,
	rollupNodeDefinition,
	type RollupNodeProps,
} from './nodes/rollup/definition'


// The table node: a live, read-only view of the board. Replaces the rollup, and absorbs its big number.
export {
	TABLE_MIN_HEIGHT,
	TABLE_NODE_TYPE,
	tableNodeDefinition,
	tablesExtension,
	type TableNodeProps,
} from './nodes/table/definition'
export {
	DEFAULT_MAX_ROWS,
	FILTER_OPS,
	LABEL_COLUMN,
	LAYOUT_MODES,
	SUMMARY_OPS,
	TABLE_SCOPES,
	columnTitle,
	defaultTableProps,
	filterOpsForType,
	summaryIsCount,
	summaryIsPercent,
	summaryKeepsUnit,
	summaryLabel,
	summaryOpsForType,
	type FilterOp,
	type LayoutMode,
	type MoneyConfig,
	type SummaryOp,
	type TableColumn,
	type TableFilter,
	type TableSort,
	type TableSource,
} from './nodes/table/spec'
export {
	EMPTY_TABLE,
	moneyOutcome,
	queryTable,
	sharedUnit,
	summarise,
	type MoneyContext,
	type TableGroup,
	type TableResult,
	type TableRow,
} from './nodes/table/query'
export { areTableResultsEqual, getTableResult } from './nodes/table/engine'
export {
	ROLLUPS_TO_TABLES_MIGRATION_ID,
	rollupsToTablesMigrations,
} from './nodes/table/rollupsToTables'

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
export {
	getPageEdges,
	getPageFacts,
	getRollupResult,
	// The one-shot counterpart to `getPageFacts`, for callers that ask once rather than render.
	readPageFacts,
	rollupStats,
	shapeFacts,
} from './nodes/rollup/engine'
export { shapeLabel } from './properties/labels'
export { ITEMS_TO_NOTES_MIGRATION_ID, itemsToNotesMigrations } from './properties/itemsToNotes'
export {
	EDGE_DIRECTIONS,
	EDGE_DIRECTION_LABELS,
	EMPTY_EDGE_INDEX,
	areEdgeIndexesEqual,
	buildEdgeIndex,
	edgesTouching,
	otherEnd,
	type Edge,
	type EdgeDirection,
	type EdgeIndex,
} from './edges'
// Writing relations, next to reading them — one definition of what an edge is. `isHiddenRelation` is
// the one place that answers "is this relation drawn?", so no reader can disagree with another.
export {
	HIDDEN_RELATION_META,
	connectShapes,
	deleteRelationsWithShapes,
	disconnectShapes,
	isHiddenRelation,
	isRelation,
	relationEnds,
	setRelationHidden,
	type ConnectOptions,
	type HistoryOptions,
} from './relations'
// How much of the wiring the board draws — the other half of hiding, and a per-board view.
export {
	DEFAULT_RELATION_VIEW,
	RELATION_VIEWS,
	RELATION_VIEW_LABELS,
	RELATION_VIEW_META,
	RELATION_VIEW_NOTES,
	cycleRelationView,
	isRelationDrawn,
	nextRelationView,
	parseRelationView,
	readRelationView,
	setRelationView,
	type RelationView,
} from './relationView'
export { PropertiesPopover } from './properties/PropertiesPopover'
export { PropertyStrip } from './properties/PropertyStrip'

/**
 * Collections: what a shape *gathers*, as opposed to what it *is*.
 *
 * A table used to be a node type; this makes it a thing any shape can do.
 */
export { CollectionStrip } from './collections/CollectionStrip'
export { CollectionEditor } from './collections/CollectionEditor'
export {
	COLLECTION_VIEWS,
	defaultCollection,
	hasCollection,
	readCollection,
	setCollection,
	type Collection,
	type CollectionView,
} from './collections/spec'
export {
	runCollection,
	EMPTY_COLLECTION_RESULT,
	type CollectionResult,
	type CollectionRow,
} from './collections/engine'
export { renderExpressions, type ExpressionContext } from './collections/expressions'
// The `{…}` helper for CodeMirror-based editors — how an extension's own editor (the markdown
// note's, say) offers the same expression completion tldraw's text editors get.
export { expressionHelper } from './collections/completion'
export { expressionSuggestExtension } from './collections/suggestExtension'
export {
	expressionBodyAt,
	expressionSuggestions,
	type Suggestion,
	type SuggestionKind,
} from './collections/suggest'
export { SuggestMenu, stepSelection } from './collections/suggestMenu'
export {
	useExpressionShape,
	substituteRichText,
	type ShapeWithRichText,
} from './collections/shapeText'

import { itemNodeDefinition } from './nodes/item/definition'
import { getNodeDefinition, registerNode, type NodeDefinition } from './registry'
import { rollupNodeDefinition } from './nodes/rollup/definition'

/**
 * Registers the built-in **legacy** node types — item and rollup, both deprecated and both rewritten
 * away by store migrations. They are not extensions: they exist only so boards that predate their
 * migrations still validate, so they are core schema, unconditionally registered, never toggleable.
 *
 * Idempotent, and — importantly — **invoked below at module load**. The registry is the single
 * source of truth for shape utils, tools and toolbar entries, and consumers legitimately read it at
 * their own module scope. ESM guarantees this module finishes evaluating before any importer's body
 * runs, so registering here means the registry is never observed empty. (Requiring the app to call
 * this imperatively was a real bug: `createNodeTools()` ran at import time, saw an empty registry,
 * and the node tools silently never existed while shape utils — read from a separate array — did.)
 *
 * The *live* node types arrive as extensions through `registerExtension`, from the app's composition
 * root — which must therefore be imported before any module that reads the registry at module scope
 * (the app's `extensions.ts` is imported first by `Board.tsx` for exactly this reason).
 */
export function registerBuiltinNodes(): void {
	for (const def of [itemNodeDefinition, rollupNodeDefinition]) {
		if (!getNodeDefinition(def.type)) registerNode(def as unknown as NodeDefinition<never>)
	}
}

registerBuiltinNodes()
