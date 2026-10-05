/// <reference path="./lib/es2025-base64.d.ts" />
// Important! don't move this tlschema re-export to lib/index.ts, doing so causes esbuild to produce
// incorrect output. https://github.com/evanw/esbuild/issues/1737

export {
	EMPTY_ARRAY,
	atom,
	computed,
	react,
	transact,
	transaction,
	whyAmIRunning,
	type Atom,
	type Computed,
	type Signal,
} from '@tldraw/state'
export {
	DefaultColorThemePalette,
	getDefaultColorTheme,
	type TLDefaultColorTheme,
	type TLDefaultColorThemeColor,
} from './lib/theme/defaultColorTheme'
export {
	EMBED_DEFINITIONS,
	embedShapePermissionDefaults,
	type EmbedDefinition,
	type TLEmbedShapePermissions,
} from './lib/embeds/embedDefinitions'
export {
	isEmptyRichText,
	renderHtmlFromRichText,
	richTextToPlainText,
	tipTapDefaultExtensions,
	trimRichText,
} from './lib/utils/richText'
export { isValidUrl } from './lib/utils/url'
export {
	getArrowBindings,
	getArrowTerminal,
	getArrowTerminals,
	isArrowTerminal,
	type TLArrowEnd,
	type TLArrowShapeTerminal,
} from './lib/editor/shapes/shared/arrow/terminals'
// The React bindings moved to their own package after 2023.
export { track, useComputed, useQuickReactor, useReactor, useValue } from '@tldraw/state-react'
// eslint-disable-next-line local/no-export-star
export * from '@tldraw/store'
// eslint-disable-next-line local/no-export-star
export * from '@tldraw/tlschema'
// Shadows the schema package's narrower versions: see shape-types.ts.
export type { TLHandle, TLShape, TLShapePartial } from './lib/editor/types/shape-types'
export type { TLBindingCreate, TLBindingUpdate } from './lib/editor/types/binding-types'
export { ArrowBindingUtil } from './lib/editor/bindings/ArrowBindingUtil'
export {
	BindingUtil,
	type BindingOnChangeOptions,
	type BindingOnCreateOptions,
	type BindingOnDeleteOptions,
	type BindingOnShapeChangeOptions,
	type BindingOnShapeDeleteOptions,
	type TLBindingUtilConstructor,
} from './lib/editor/bindings/BindingUtil'
// eslint-disable-next-line local/no-export-star
export * from '@tldraw/utils'
// eslint-disable-next-line local/no-export-star
export * from '@tldraw/validate'
export {
	ErrorScreen,
	LoadingScreen,
	TldrawEditor,
	type TLOnMountHandler,
	type TldrawEditorBaseProps,
	type TldrawEditorProps,
} from './lib/TldrawEditor'
export { Canvas } from './lib/components/Canvas'
export {
	ErrorBoundary,
	OptionalErrorBoundary,
	type TLErrorBoundaryProps,
} from './lib/components/ErrorBoundary'
export { HTMLContainer, type HTMLContainerProps } from './lib/components/HTMLContainer'
export { PositionedOnCanvas } from './lib/components/PositionedOnCanvas'
export { SVGContainer, type SVGContainerProps } from './lib/components/SVGContainer'
export { ShapeIndicator, type TLShapeIndicatorComponent } from './lib/components/ShapeIndicator'
export {
	DefaultBackground,
	type TLBackgroundComponent,
} from './lib/components/default-components/DefaultBackground'
export {
	DefaultBrush,
	type TLBrushComponent,
} from './lib/components/default-components/DefaultBrush'
export {
	DefaultCollaboratorHint,
	type TLCollaboratorHintComponent,
} from './lib/components/default-components/DefaultCollaboratorHint'
export {
	DefaultCursor,
	type TLCursorComponent,
} from './lib/components/default-components/DefaultCursor'
export { DefaultErrorFallback } from './lib/components/default-components/DefaultErrorFallback'
export { DefaultGrid, type TLGridComponent } from './lib/components/default-components/DefaultGrid'
export {
	DefaultHandle,
	type TLHandleComponent,
} from './lib/components/default-components/DefaultHandle'
export {
	DefaultHandles,
	type TLHandlesComponent,
} from './lib/components/default-components/DefaultHandles'
export {
	DefaultHoveredShapeIndicator,
	type TLHoveredShapeIndicatorComponent,
} from './lib/components/default-components/DefaultHoveredShapeIndicator'
export { type TLInFrontOfTheCanvas } from './lib/components/default-components/DefaultInFrontOfTheCanvas'
export { type TLOnTheCanvas } from './lib/components/default-components/DefaultOnTheCanvas'
export {
	DefaultScribble,
	type TLScribbleComponent,
} from './lib/components/default-components/DefaultScribble'
export {
	DefaultSelectionBackground,
	type TLSelectionBackgroundComponent,
} from './lib/components/default-components/DefaultSelectionBackground'
export {
	DefaultSelectionForeground,
	type TLSelectionForegroundComponent,
} from './lib/components/default-components/DefaultSelectionForeground'
export {
	DefaultSnapLine,
	type TLSnapLineComponent,
} from './lib/components/default-components/DefaultSnapLine'
export {
	DefaultSpinner,
	type TLSpinnerComponent,
} from './lib/components/default-components/DefaultSpinner'
export {
	DefaultSvgDefs,
	type TLSvgDefsComponent,
} from './lib/components/default-components/DefaultSvgDefs'
export {
	TAB_ID,
	createSessionStateSnapshotSignal,
	extractSessionStateFromLegacySnapshot,
	loadSessionStateSnapshotIntoStore,
	type TLSessionStateSnapshot,
} from './lib/config/TLSessionStateSnapshot'
export {
	USER_COLORS,
	defaultUserPreferences,
	getFreshUserPreferences,
	getUserPreferences,
	setUserPreferences,
	type TLUserPreferences,
} from './lib/config/TLUserPreferences'
export {
	createTLSchemaFromUtils,
	createTLStore,
	type TLAnyBindingUtilConstructor,
	type TLStoreEventInfo,
	type TLStoreOptions,
} from './lib/config/createTLStore'
export { createTLUser } from './lib/config/createTLUser'
export { coreShapes, type TLAnyShapeUtilConstructor } from './lib/config/defaultShapes'
export {
	ANIMATION_MEDIUM_MS,
	ANIMATION_SHORT_MS,
	CAMERA_SLIDE_FRICTION,
	DEFAULT_ANIMATION_OPTIONS,
	DOUBLE_CLICK_DURATION,
	DRAG_DISTANCE,
	GRID_STEPS,
	HASH_PATTERN_ZOOM_NAMES,
	HIT_TEST_MARGIN,
	MAX_PAGES,
	MAX_SHAPES_PER_PAGE,
	MAX_ZOOM,
	MIN_ZOOM,
	MULTI_CLICK_DURATION,
	SVG_PADDING,
	ZOOMS,
} from './lib/constants'
export {
	Editor,
	type TLAnimationOptions,
	type TLEditorOptions,
	type TLResizeShapeOptions,
	type TLTextOptions,
} from './lib/editor/Editor'
export {
	SnapManager,
	type GapsSnapLine,
	type PointsSnapLine,
	type SnapLine,
	type SnapPoint,
} from './lib/editor/managers/SnapManager'
export { BaseBoxShapeUtil, type TLBaseBoxShape } from './lib/editor/shapes/BaseBoxShapeUtil'
export {
	ShapeUtil,
	type TLOnBeforeCreateHandler,
	type TLOnBeforeUpdateHandler,
	type TLOnBindingChangeHandler,
	type TLOnChildrenChangeHandler,
	type TLOnClickHandler,
	type TLOnDoubleClickHandleHandler,
	type TLOnDoubleClickHandler,
	type TLOnDragHandler,
	type TLOnEditEndHandler,
	type TLOnHandleChangeHandler,
	type TLOnResizeEndHandler,
	type TLOnResizeHandler,
	type TLOnResizeStartHandler,
	type TLOnRotateEndHandler,
	type TLOnRotateHandler,
	type TLOnRotateStartHandler,
	type TLOnTranslateEndHandler,
	type TLOnTranslateHandler,
	type TLOnTranslateStartHandler,
	type TLResizeInfo,
	type TLResizeMode,
	type TLShapeUtilCanvasSvgDef,
	type TLShapeUtilConstructor,
	type TLShapeUtilCanBindOpts,
	type TLShapeUtilFlag,
} from './lib/editor/shapes/ShapeUtil'
export { GroupShapeUtil } from './lib/editor/shapes/group/GroupShapeUtil'
export { getArrowheadPathForType } from './lib/editor/shapes/shared/arrow/arrowheads'
export {
	getCurvedArrowHandlePath,
	getSolidCurvedArrowPath,
} from './lib/editor/shapes/shared/arrow/curved-arrow'
export { getArrowTerminalsInArrowSpace } from './lib/editor/shapes/shared/arrow/shared'
export {
	getSolidStraightArrowPath,
	getStraightArrowHandlePath,
} from './lib/editor/shapes/shared/arrow/straight-arrow'
export { resizeBox, type ResizeBoxOptions } from './lib/editor/shapes/shared/resizeBox'
export { BaseBoxShapeTool } from './lib/editor/tools/BaseBoxShapeTool/BaseBoxShapeTool'
export { StateNode, type TLStateNodeConstructor } from './lib/editor/tools/StateNode'
export { type SvgExportContext, type SvgExportDef } from './lib/editor/types/SvgExportContext'
export { type TLContent } from './lib/editor/types/clipboard-types'
export { type TLEventMap, type TLEventMapHandler } from './lib/editor/types/emit-types'
export {
	EVENT_NAME_MAP,
	type TLBaseEventInfo,
	type TLCLickEventName,
	type TLCancelEvent,
	type TLCancelEventInfo,
	type TLClickEvent,
	type TLClickEventInfo,
	type TLCompleteEvent,
	type TLCompleteEventInfo,
	type TLEnterEventHandler,
	type TLEventHandlers,
	type TLEventInfo,
	type TLEventName,
	type TLExitEventHandler,
	type TLInterruptEvent,
	type TLInterruptEventInfo,
	type TLKeyboardEvent,
	type TLKeyboardEventInfo,
	type TLKeyboardEventName,
	type TLPinchEvent,
	type TLPinchEventInfo,
	type TLPinchEventName,
	type TLPointerEvent,
	type TLPointerEventInfo,
	type TLPointerEventName,
	type TLPointerEventTarget,
	type TLTickEvent,
	type TLWheelEvent,
	type TLWheelEventInfo,
	type UiEvent,
	type UiEventType,
} from './lib/editor/types/event-types'
export {
	type TLExternalAssetContent,
	type TLExternalContent,
	type TLExternalContentSource,
} from './lib/editor/types/external-content'
export {
	type TLCommand,
	type TLCommandHandler,
	type TLHistoryEntry,
	type TLHistoryMark,
} from './lib/editor/types/history-types'
export { type RequiredKeys, type TLSvgOptions } from './lib/editor/types/misc-types'
export { type TLResizeHandle, type TLSelectionHandle } from './lib/editor/types/selection-types'
export { useContainer } from './lib/hooks/useContainer'
export { getCursor } from './lib/hooks/useCursor'
export { useEditor } from './lib/hooks/useEditor'
export type { TLEditorComponents } from './lib/hooks/useEditorComponents'
export { useShallowArrayIdentity, useShallowObjectIdentity } from './lib/hooks/useIdentity'
export { useIsCropping } from './lib/hooks/useIsCropping'
export { useIsDarkMode } from './lib/hooks/useIsDarkMode'
export { useIsEditing } from './lib/hooks/useIsEditing'
export { useLocalStore } from './lib/hooks/useLocalStore'
export { usePeerIds } from './lib/hooks/usePeerIds'
export { usePresence } from './lib/hooks/usePresence'
export { useSelectionEvents } from './lib/hooks/useSelectionEvents'
export { useImageOrVideoAsset } from './lib/hooks/useImageOrVideoAsset'
export { useTLStore } from './lib/hooks/useTLStore'
export { useTransform } from './lib/hooks/useTransform'
export {
	Box2d,
	ROTATE_CORNER_TO_SELECTION_CORNER,
	rotateSelectionHandle,
	type BoxLike,
	type RotateCorner,
	type SelectionCorner,
	type SelectionEdge,
	type SelectionHandle,
} from './lib/primitives/Box2d'
export { Matrix2d, type Matrix2dModel } from './lib/primitives/Matrix2d'
export { Vec2d, type VecLike } from './lib/primitives/Vec2d'
// Today's names for the 2023 classes (docs/fork-parity.md E18).
export { Box2d as Box } from './lib/primitives/Box2d'
export { Vec2d as Vec } from './lib/primitives/Vec2d'
// Typed for the fork's TLShape; shadows the store's (see the file).
export { createComputedCache } from './lib/utils/createComputedCache'
export type { TLHistoryMode } from './lib/editor/managers/HistoryManager'
export { EASINGS } from './lib/primitives/easings'
export { Arc2d } from './lib/primitives/geometry/Arc2d'
export { Circle2d } from './lib/primitives/geometry/Circle2d'
export { CubicBezier2d } from './lib/primitives/geometry/CubicBezier2d'
export { CubicSpline2d } from './lib/primitives/geometry/CubicSpline2d'
export { Edge2d } from './lib/primitives/geometry/Edge2d'
export { Ellipse2d } from './lib/primitives/geometry/Ellipse2d'
export { Geometry2d } from './lib/primitives/geometry/Geometry2d'
export { Group2d } from './lib/primitives/geometry/Group2d'
export { Polygon2d } from './lib/primitives/geometry/Polygon2d'
export { Polyline2d } from './lib/primitives/geometry/Polyline2d'
export { Rectangle2d } from './lib/primitives/geometry/Rectangle2d'
export { Stadium2d } from './lib/primitives/geometry/Stadium2d'
export {
	intersectLineSegmentPolygon,
	intersectLineSegmentPolyline,
	intersectPolygonPolygon,
	linesIntersect,
	polygonsIntersect,
} from './lib/primitives/intersect'
export {
	EPSILON,
	PI,
	PI2,
	SIN,
	TAU,
	angleDelta,
	approximately,
	areAnglesCompatible,
	average,
	canonicalizeRotation,
	clamp,
	clampRadians,
	clockwiseAngleDist,
	degreesToRadians,
	getArcLength,
	getPointOnCircle,
	getPolygonVertices,
	getStarBounds,
	getSweep,
	isAngleBetween,
	isSafeFloat,
	lerpAngles,
	longAngleDist,
	perimeterOfEllipse,
	pointInBounds,
	pointInCircle,
	pointInEllipse,
	pointInPolygon,
	pointInPolyline,
	pointInRect,
	pointNearToLineSegment,
	pointNearToPolyline,
	precise,
	radiansToDegrees,
	rangeIntersection,
	shortAngleDist,
	snapAngle,
	toDomPrecision,
	toFixed,
	toPrecision,
} from './lib/primitives/utils'
export {
	ReadonlySharedStyleMap,
	SharedStyleMap,
	type SharedStyle,
} from './lib/utils/SharedStylesMap'
export { WeakMapCache } from './lib/utils/WeakMapCache'
export { dataUrlToFile } from './lib/utils/assets'
export { getSvgAsDataUrl, getSvgAsImage } from './lib/utils/export'
export { getBrowserCanvasMaxSize, type CanvasMaxSize } from './lib/utils/getBrowserCanvasMaxSize'
export { debugFlags, featureFlags, type DebugFlag } from './lib/utils/debug-flags'
export {
	loopToHtmlElement,
	preventDefault,
	releasePointerCapture,
	setPointerCapture,
	stopEventPropagation,
} from './lib/utils/dom'
export { getIncrementedName } from './lib/utils/getIncrementedName'
export { getPointerInfo } from './lib/utils/getPointerInfo'
export { getSvgPathFromPoints } from './lib/utils/getSvgPathFromPoints'
export { hardResetEditor } from './lib/utils/hardResetEditor'
export { normalizeWheel } from './lib/utils/normalizeWheel'
export { refreshPage } from './lib/utils/refreshPage'
export {
	getIndexAbove,
	getIndexBelow,
	getIndexBetween,
	getIndices,
	getIndicesAbove,
	getIndicesBelow,
	getIndicesBetween,
	sortByIndex,
} from './lib/utils/reordering/reordering'
export {
	applyRotationToSnapshotShapes,
	getRotationSnapshot,
	type TLRotationSnapshot,
} from './lib/utils/rotation'
export { runtime, setRuntimeOverrides } from './lib/utils/runtime'
export { type TLStoreWithStatus } from './lib/utils/sync/StoreWithStatus'
export { hardReset } from './lib/utils/sync/hardReset'
export { uniq } from './lib/utils/uniq'
export { uniqueId } from './lib/utils/uniqueId'
export { openWindow } from './lib/utils/window-open'

/** @polyfills */

import 'core-js/stable/array/at'
import 'core-js/stable/array/flat'
import 'core-js/stable/array/flat-map'
import 'core-js/stable/string/at'
import 'core-js/stable/string/replace-all'
