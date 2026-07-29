import {
	BaseBoxShapeUtil,
	HTMLContainer,
	T,
	TLBaseShape,
	TLPropsMigrations,
	type Editor,
	type RecordProps,
	type TLAnyShapeUtilConstructor,
	type TLBaseBoxShape,
	type TLResizeInfo,
	type TLShapePartial,
	type TLShapeUtilCanBindOpts,
	resizeBox,
} from 'tldraw'
import type { ComponentType } from 'react'
import type { NodeFacts } from './facts'

/**
 * Box geometry is owned by the factory, not by definitions. A definition never declares or
 * defaults `w`/`h` — see `createNodeShapeUtil`. This is what lets a future plugin-supplied
 * definition be structurally incapable of getting box-ness wrong.
 */
export interface NodeBaseProps {
	w: number
	h: number
}

/**
 * The shape type a node definition sees. Structural on purpose: tldraw 5's `TLShape` is a closed
 * union keyed by `TLGlobalShapePropsMap` (see `shape-types.ts`), which a runtime-loaded plugin can
 * never augment. Writing definitions against this structural type — and casting once, inside the
 * factory — is what keeps the plugin path open.
 */
export type NodeShape<Props extends object = object> = TLBaseShape<string, Props & NodeBaseProps>

export interface NodeComponentProps<Props extends object> {
	shape: NodeShape<Props>
	isEditing: boolean
	editor: Editor
}

/**
 * The single interface every smart node implements — and, unchanged, the future plugin SDK surface
 * (§4.1). A plugin is just something that supplies `NodeDefinition`s; the host already consumes
 * this interface, so adding a sandboxed runtime later needs no host refactor.
 */
export interface NodeDefinition<Props extends object = object> {
	/** Namespaced: `node.item` today, `plugin.<vendor>.<name>` later. */
	type: string
	/** Shown in the toolbar and menus — the UI is registry-driven, never per-type hardcoded (§7). */
	label: string
	/** Single character or short glyph for the toolbar button. */
	icon: string
	/** tldraw validators for this node's own props. JSON scalars only. `w`/`h` are injected. */
	props: { [K in keyof Props]: T.Validatable<Props[K]> }
	/** REQUIRED from v1 — every props change ships one (§7). */
	migrations: TLPropsMigrations
	defaultProps: () => Props
	defaultSize: { w: number; h: number }
	component: ComponentType<NodeComponentProps<Props>>
	/** `true` → double-click enters tldraw's editing state and the component gets `isEditing`. */
	canEdit?: boolean
	/** Locks the resize aspect ratio (unused by the MVP nodes, needed by future media nodes). */
	aspectRatioLocked?: boolean
	/** The rollup contract (§4.3). Omit for nodes that expose no structured data. */
	extractFacts?: (shape: NodeShape<Props>) => NodeFacts | null

	// RESERVED — not implemented in the MVP. A later app-side scheduler will call `refresh` and
	// write the result into props; rendering, persistence, undo and rollups already work on props.
	// dataProvider?: { refresh(props: Props): Promise<Partial<Props>>; intervalMs: number }
}

const BOX_PROPS = {
	w: T.nonZeroNumber,
	h: T.nonZeroNumber,
}

/**
 * The one way a node component writes to its own props.
 *
 * Two jobs. First, history: the write is wrapped in `editor.run`, so one user action is one undo
 * entry (§7) — nodes never have to remember to batch. Second, typing: a definition holds the
 * structural `NodeShape<Props>` whose `type` is `string`, which tldraw's closed-union `updateShape`
 * rejects. The cast lives here, once, instead of at every call site — and it is sound, because the
 * shape was created by `createNodeShapeUtil` from a definition whose props are exactly `Props`.
 */
export function updateNodeProps<Props extends object>(
	editor: Editor,
	shape: NodeShape<Props>,
	props: Partial<Props>
): void {
	editor.run(() => {
		editor.updateShape({ id: shape.id, type: shape.type, props } as unknown as TLShapePartial)
	})
}

/**
 * Turns a `NodeDefinition` into a tldraw `ShapeUtil`. This is the only tldraw-coupled file in the
 * project's node layer — the reason a tldraw swap or a plugin runtime is a contained change.
 */
export function createNodeShapeUtil<Props extends object>(
	def: NodeDefinition<Props>
): TLAnyShapeUtilConstructor {
	// `Shape` is the structural view the definition is written against; `TLBaseBoxShape` is what
	// tldraw's class hierarchy demands. The two are structurally identical for our shapes — a
	// `TLBaseShape` with numeric `w`/`h` — but TypeScript can't see that for an arbitrary `Props`,
	// because `TLBaseBoxShape` resolves through the closed `TLShape` union. Hence the casts below.
	// They are confined to this class, which is the whole reason this file exists.
	type Shape = NodeShape<Props>

	class NodeShapeUtil extends BaseBoxShapeUtil<TLBaseBoxShape> {
		static override type = def.type
		static override props = { ...BOX_PROPS, ...def.props } as unknown as RecordProps<TLBaseBoxShape>
		static override migrations = def.migrations

		override getDefaultProps(): TLBaseBoxShape['props'] {
			const props: Shape['props'] = { ...def.defaultProps(), ...def.defaultSize }
			return props as unknown as TLBaseBoxShape['props']
		}

		override canEdit(): boolean {
			return def.canEdit ?? false
		}

		override canResize(): boolean {
			return true
		}

		override isAspectRatioLocked(): boolean {
			return def.aspectRatioLocked ?? false
		}

		/** Nodes are arrows' natural targets on a diagram board, so binding stays enabled. */
		override canBind(_opts: TLShapeUtilCanBindOpts): boolean {
			return true
		}

		override onResize(shape: TLBaseBoxShape, info: TLResizeInfo<TLBaseBoxShape>) {
			return resizeBox(shape, info)
		}

		/** v5 replaced `indicator()` with `getIndicatorPath()`; see docs/tldraw-api-notes.md. */
		override getIndicatorPath(shape: TLBaseBoxShape): Path2D {
			const path = new Path2D()
			path.rect(0, 0, shape.props.w, shape.props.h)
			return path
		}

		override component(rawShape: TLBaseBoxShape) {
			const shape = rawShape as unknown as Shape
			const isEditing = this.editor.getEditingShapeId() === shape.id
			const Component = def.component
			return (
				<HTMLContainer
					id={shape.id}
					style={{
						width: shape.props.w,
						height: shape.props.h,
						// Display mode must not swallow pointer events, or the shape stops behaving
						// like a shape (no drag, no marquee select). Editing components opt back in
						// on their own root — see §4.6.
						pointerEvents: isEditing ? 'all' : 'none',
						// Clipped in display mode so content stays inside the card's rounded bounds,
						// but *not* while editing: the item field editor and rollup config render as
						// popovers below the node, and `hidden` clipped them out of existence.
						overflow: isEditing ? 'visible' : 'hidden',
					}}
				>
					<Component shape={shape} isEditing={isEditing} editor={this.editor} />
				</HTMLContainer>
			)
		}
	}

	// `TLAnyShapeUtilConstructor` is tldraw's own type for this — it's what `<Tldraw shapeUtils>`
	// accepts — so no cast is needed here.
	return NodeShapeUtil
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const registry = new Map<string, NodeDefinition<never>>()

export function registerNode<Props extends object>(def: NodeDefinition<Props>): void {
	if (registry.has(def.type)) {
		throw new Error(`Node type "${def.type}" is already registered`)
	}
	registry.set(def.type, def as unknown as NodeDefinition<never>)
}

export function getNodeDefinition(type: string): NodeDefinition<never> | undefined {
	return registry.get(type)
}

/** Stable ordering so toolbar entries don't reshuffle between reloads. */
export function getNodeDefinitions(): NodeDefinition<never>[] {
	return [...registry.values()]
}

export function isNodeType(type: string): boolean {
	return registry.has(type)
}

/** Used by tests to get a clean registry. */
export function clearNodeRegistry(): void {
	registry.clear()
}
