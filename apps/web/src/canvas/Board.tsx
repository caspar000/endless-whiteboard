// The extension composition root. Must be evaluated before this module's body: the shape utils and
// tools below are built at module scope from the registry the root populates.
import '../extensions'
import {
	createNodeShapeUtil,
	PropertiesPopover,
	getNodeDefinitions,
	getNodeTypesVersion,
	subscribeToNodeDefinitions,
	mergeProperties,
	readShapePropertyDefs,
	rollupsToTablesMigrations,
	itemsToNotesMigrations,
	rollupStats,
	expressionSuggestExtension,
	readPropertyRegistry,
} from '@lifeboard/node-kit'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
	FrameShapeUtil,
	Tldraw,
	createShapeId,
	type Editor,
	type TLAnyShapeUtilConstructor,
	type TLComponents,
	type TldrawOptions,
	type TLEventInfo,
	useEditor,
	useValue,
	tipTapDefaultExtensions,
	type TLTextOptions,
} from 'tldraw'
import 'tldraw/tldraw.css'
import { touchBoard, type BoardMeta } from '../boards/boardIndex'
import { seedDemoBoard } from '../boards/demoBoard'
import { usePlatform } from '../platform/PlatformContext'
import { createLifeboardAssetStore } from '../persistence/assetStore'
import { MAX_IMPORT_BYTES } from '../persistence/downscale'
import { clearPendingRestore, takePendingRestore } from '../persistence/pendingRestore'
import { persistenceKeyForBoard, type RawBoardSnapshot } from '../persistence/tldrawLocalDb'
import { CanvasBackground } from './CanvasBackground'
import { CanvasToolbar } from './CanvasToolbar'
import { FileImportHandler } from './FileImportHandler'
import { expressionShapeUtils } from './expressionShapeUtils'
import { ForeignPropertyStrips } from './ForeignPropertyStrips'
import { SelectionToolbar } from './SelectionToolbar'
import { closeProperties, getPropertiesTarget } from './propertiesTarget'
import { createNodeTools } from './nodeTools'
import { nodeComponents, nodeUiOverrides } from './uiOverrides'
import { RollupDebugBadge } from './RollupDebugBadge'

/**
 * The canvas. `persistenceKey` gives us tldraw's built-in IndexedDB persistence — throttled writes,
 * cross-tab BroadcastChannel sync, and automatic schema migration on load — with no pipeline of our
 * own (§4.4). `key={boardId}` forces a clean remount when switching boards, so no state leaks
 * between them.
 */

/**
 * Built per *schema version*, not per render: rebuilding shape utils on every render would recreate
 * every shape's class identity and defeat tldraw's caching. Both lists come from the same registry,
 * so a node type can never end up with a shape util but no tool (or vice versa).
 *
 * Keyed on `getNodeTypesVersion()` rather than computed once at module scope, because a type that
 * appears *after* this module is evaluated would otherwise never get a util — the editor would then
 * throw "No shape util found for type …" the moment anything created one, taking the board down.
 * That happens whenever vite HMR re-evaluates an extension, and it is exactly what a runtime-loaded
 * plugin will do on purpose. In a production build the version never changes after startup, so this
 * is computed once there too.
 */
function buildShapeUtils(): TLAnyShapeUtilConstructor[] {
	return getNodeDefinitions().map(createNodeShapeUtil)
}

/**
 * The frame, made a container rather than a card: no fill, a colourable border.
 *
 * A frame's default body is opaque, which on a whiteboard is the wrong way round — you group things
 * with a frame to say "these belong together", not to hide the paper under them. `getCustomDisplayValues`
 * is tldraw's own merge hook over `getDefaultDisplayValues`, so this replaces the fill and nothing else.
 *
 * `showColors: true` is what makes the border colourable at all: it is the flag that registers the
 * frame's existing `color` prop as a real `DefaultColorStyle` style prop, so `setStyleForSelectedShapes`
 * reaches it and the border, heading and label all derive from it. The prop is already in the schema
 * either way (`getDefaultProps` has always returned `color: 'black'`), so turning this on needs no
 * migration — nothing about what is stored changes.
 *
 * Replacing a built-in works because `<Tldraw>` merges by shape type
 * (`mergeArraysAndReplaceDefaults('type', …)`), so a `frame` util here takes the default's place.
 */
const frameShapeUtil = FrameShapeUtil.configure({
	showColors: true,
	getCustomDisplayValues: () => ({
		// Both, because the fill is read from whichever of the two `showColors` selects.
		fillColor: 'transparent',
		showColorsFillColor: 'transparent',
	}),
})

function buildBoardShapeUtils(): TLAnyShapeUtilConstructor[] {
	return [
		...buildShapeUtils(),
		frameShapeUtil,
		// Stickies, text, shape labels and arrow labels evaluate `{…}` too — see expressionShapeUtils.
		...expressionShapeUtils,
	]
}

/**
 * Migrations that rewrite records across types, rather than one shape's props.
 *
 * Order here is not what sequences them — `rollupsToTablesMigrations` declares `dependsOn` — but keeping
 * them in dependency order makes the intent readable.
 */
const storeMigrations = [itemsToNotesMigrations, rollupsToTablesMigrations]

const canvasComponents: TLComponents = {
	...nodeComponents,
	// The paper backdrop, and whichever grid the user has chosen (see CanvasBackground.tsx).
	Background: CanvasBackground,
	// tldraw's own grid is drawn only while `isGridMode` is on, and that same flag is what makes
	// dragging snap. Rendering the grid from `Background` instead is what lets "show a grid" and "snap
	// to the grid" be two separate settings; this slot must stay empty or tldraw's copy would appear on
	// top of ours the moment snapping was switched on.
	Grid: null,
	/*
	 * The top-left strip — main menu, page picker, undo/redo, delete, duplicate — is removed.
	 *
	 * Most of it is about a document model this app doesn't have: a board *is* the unit, so a page
	 * picker offers to navigate somewhere nothing ever puts anything, and tldraw's main menu duplicates
	 * an export and a preferences screen the app already owns.
	 *
	 * The quick actions do go with it. Delete and duplicate survive on a shape's own context menu, but
	 * **undo and redo become keyboard-only** — tldraw puts neither in the context menu. Worth knowing
	 * rather than worth blocking on: if they are wanted back, the bottom dock is where they belong, not
	 * a second floating bar in the corner opposite it.
	 */
	MenuPanel: null,
	// The colour/opacity panel in the top-right is removed: the custom toolbar's expansion row
	// (CanvasToolbar) is where styles for tldraw's own shapes are set now.
	StylePanel: null,
	// Our own bottom dock instead of tldraw's toolbar (see CanvasToolbar.tsx).
	Toolbar: CanvasToolbar,
	// The floating bar above a selected shape (see SelectionToolbar.tsx).
	InFrontOfTheCanvas: SelectionToolbar,
	// tldraw's separate image/video bars are merged *into* the selection toolbar — their content
	// components render inside it — so the standalone versions must not also appear.
	ImageToolbar: null,
	VideoToolbar: null,
	// Properties for shapes whose components we don't own. See ForeignPropertyStrips.
	OnTheCanvas: ForeignPropertyStrips,
}

/*
 * Double-clicking empty canvas is tldraw's again — it makes a text shape.
 *
 * It used to make a markdown note, which read well in isolation and badly in practice: double-click
 * is the gesture for "act on the thing under the pointer", and claiming it board-wide meant every
 * near-miss on a shape, every double-click to deselect, and every gesture aimed at a frame's empty
 * interior left a note behind. Notes are drawn from the dock like every other node instead.
 */

/**
 * Adopts the property definitions carried by a pasted shape.
 *
 * A shape stores a small sidecar of the definitions it uses (`lifeboard:propDefs`), which is what makes
 * copying between boards work: without it, the pasted values would be unrecoverable id → value pairs
 * with no name, type or unit. Merging is idempotent and skips ids the board already knows, so the
 * target board's own meaning of a property always wins over the copy's.
 *
 * Guarded to `source === 'user'`: loading a board creates every shape too, and re-merging a whole
 * board's sidecars on open would write to the document record for nothing.
 */
function watchPastedProperties(editor: Editor): () => void {
	return editor.sideEffects.registerAfterCreateHandler('shape', (shape, source) => {
		if (source !== 'user') return
		const defs = readShapePropertyDefs(shape)
		if (defs.length) mergeProperties(editor, defs)
	})
}

// The rollup recompute counters, so the perf suite can assert the §4.3 guarantee ("zero rollup
// recomputes while dragging") against real numbers rather than wall-clock timing, which varies by
// machine. Exposed at module scope, not per mount: `rollupStats` is a singleton, and tying it to a
// mount meant a *draining* board's unmount deleted the live board's counters.
;(window as unknown as { __rollupStats?: typeof rollupStats }).__rollupStats = rollupStats

/**
 * Bridges the module-scope properties target to the panel.
 *
 * Its own component so that `useValue` runs inside the editor context, and so that a re-render caused
 * by opening the panel doesn't re-render the whole board.
 */
function PropertiesPanel() {
	const editor = useEditor()
	const shape = useValue(
		'lifeboard:properties-target',
		() => {
			const id = getPropertiesTarget()
			return id ? (editor.getShape(id) ?? null) : null
		},
		[editor]
	)
	if (!shape) return null
	return <PropertiesPopover shape={shape} editor={editor} onClose={closeProperties} />
}

export function Board({
	board,
	seedDemo = false,
	onEditor,
}: {
	board: BoardMeta
	seedDemo?: boolean
	/** Reports the live editor to the shell, which uses it to capture a thumbnail on tab switch. */
	onEditor?: (editor: Editor | null) => void
}) {
	const platform = usePlatform()
	const [restore, setRestore] = useState<{ ready: boolean; snapshot?: RawBoardSnapshot }>({
		ready: false,
	})

	/**
	 * The registered node types *are* the editor's schema, so a change to them has to rebuild the
	 * shape utils and tools — and remount the editor, since `<Tldraw>` reads both once. Constant in a
	 * production build; it moves when HMR re-evaluates an extension, or when a plugin is loaded later.
	 */
	const schemaVersion = useSyncExternalStore(subscribeToNodeDefinitions, getNodeTypesVersion)
	const shapeUtils = useMemo(buildBoardShapeUtils, [schemaVersion])
	const nodeTools = useMemo(createNodeTools, [schemaVersion])

	// An imported board carries its snapshot in KV until first open; handing it to <Tldraw> is what
	// makes tldraw run migrations on it (see persistence/pendingRestore.ts).
	useEffect(() => {
		let cancelled = false
		void takePendingRestore(platform.kv, board.id).then((snapshot) => {
			if (!cancelled) setRestore({ ready: true, ...(snapshot ? { snapshot } : {}) })
		})
		return () => {
			cancelled = true
		}
	}, [platform, board.id])

	const assets = useMemo(() => createLifeboardAssetStore(platform.blobs), [platform])

	const [editor, setEditor] = useState<Editor | null>(null)

	/**
	 * The `{…}` helper, for every text editor tldraw draws itself — sticky, text shape, geo label,
	 * arrow label. One TipTap config serves all four.
	 *
	 * Built once per board and never rebuilt: a new extension list would tear down and recreate the
	 * editor inside whatever shape is being edited, taking the caret with it. The registry is read
	 * through a ref rather than captured, because this is assembled before the editor exists and a
	 * property invented in a panel has to be offered here without leaving edit mode.
	 */
	const editorRef = useRef<Editor | null>(null)
	const textOptions = useMemo<TLTextOptions>(
		() => ({
			tipTapConfig: {
				extensions: [
					...tipTapDefaultExtensions,
					expressionSuggestExtension(() =>
						editorRef.current ? readPropertyRegistry(editorRef.current) : []
					),
				],
			},
		}),
		[]
	)

	if (!restore.ready) return <div className="lb-board__loading">Opening board…</div>

	return (
		<div className="lb-board">
			<Tldraw
				// The schema version is part of the editor's identity: new node types mean new shape
				// utils, which `<Tldraw>` only reads on mount.
				key={`${board.id}:${schemaVersion}`}
				persistenceKey={persistenceKeyForBoard(board.id)}
				{...(restore.snapshot ? { snapshot: restore.snapshot as never } : {})}
				shapeUtils={shapeUtils}
				// Store-scoped migrations run *before* validation on every load path — the IndexedDB
				// read, the `snapshot` prop above, and the fixture tests. That ordering is the only
				// reason a shape type can be retired at all: an unregistered type is a validation
				// failure, not a stale record, so the repair has to happen before the check.
				migrations={storeMigrations}
				tools={nodeTools}
				overrides={nodeUiOverrides}
				components={canvasComponents}
				/*
				 * One TipTap config serves every text editor tldraw owns — sticky, text shape, geo
				 * label, arrow label — so the `{…}` helper reaches all four from here.
				 *
				 * Built once at module scope. Rebuilding the extension list on each render would tear
				 * down and recreate the editor inside every shape being edited, losing the caret.
				 */
				textOptions={textOptions}
				// Double-clicking empty canvas asks which kind of node to create instead of silently
				// making a text shape — in an app about typed nodes, the untyped one is a poor default.
				// Only the fallback for the frame before `onMount` reports this editor and app/App.tsx sets
				// its colour-scheme preference, which overrides this. It must stay a literal: the prop is in
				// the dependency array of the effect that *constructs* the Editor, so binding it to the
				// app's theme would remount every editor on a switch — and unmounting inside tldraw's
				// persistence throttle window discards the pending write (see DRAIN_MS in app/App.tsx),
				// along with the camera, selection and undo history.
				colorScheme="dark"
				assets={assets}
				maxAssetSize={MAX_IMPORT_BYTES}
				onMount={(editor) => {
					// The pending snapshot has now been loaded and is being persisted by tldraw, so
					// drop it — otherwise reopening the board would replay the import.
					if (restore.snapshot) void clearPendingRestore(platform.kv, board.id)
					// Seed only a genuinely empty board: the demo route can be revisited (reload,
					// back button) and must not duplicate the demo content.
					if (seedDemo && editor.getCurrentPageShapeIds().size === 0) seedDemoBoard(editor)

					// Debug/test seam: lets the e2e suite assert on real store state instead of
					// scraping the DOM, and makes the console usable when diagnosing a board.
					// Cleared on unmount — leaving a disposed editor here is worse than leaving
					// nothing, because writes to it are silently dropped.
					editorRef.current = editor
					const w = window as unknown as { editor?: Editor }
					w.editor = editor
					setEditor(editor)
					onEditor?.(editor)

					const stopTracking = trackBoardActivity(
						editor,
						() => void touchBoard(platform.kv, board.id)
					)
					const stopWatchingPastes = watchPastedProperties(editor)

					return () => {
						// Guarded: while a board is draining (see DRAIN_MS in app/App.tsx) its editor
						// unmounts *after* the next one has mounted, so an unguarded delete here would
						// wipe the live editor's handle.
						editorRef.current = null
						if (w.editor === editor) delete w.editor
						onEditor?.(null)
						stopWatchingPastes()
						stopTracking()
						// The target is module-scope, so a stale id would make the next board try to open
						// a panel for a shape that isn't on it.
						closeProperties()
						// NB: no thumbnail capture here. Exporting from the unmount path ran while the
						// board host was already hidden for the drain, and tldraw's exporter dropped every
						// node background and font — previews looked right for a second and then decayed
						// into serif text. It happens in `leave()` below, while the board is still visible.
					}
				}}
			>
				{/* Children of <Tldraw> render *inside* the editor context, so they may call
				    `useEditor`. The debug badge does — rendering it as a sibling threw
				    "useEditor must be used inside of <Tldraw />" and took the whole app down in
				    dev, where the badge is the only thing that renders it. */}
				{import.meta.env.DEV && <RollupDebugBadge />}
				{/* Rendered inside <Tldraw> so it can portal into the editor's own container and track
				    the shape through pans and zooms. */}
				<PropertiesPanel />
				{/* Must be a child of <Tldraw>: it needs the toast context, and mounting after tldraw's
				    own handler registration is what lets it take over the `files` content type. */}
				<FileImportHandler />
			</Tldraw>
		</div>
	)
}

/**
 * Keeps the board index's `updatedAt` fresh without writing on every keystroke: the store fires
 * constantly while drawing, so writes are coalesced to at most one per interval.
 */
function trackBoardActivity(editor: Editor, touch: () => void): () => void {
	const INTERVAL = 30_000
	let last = 0
	const unlisten = editor.store.listen(
		() => {
			const now = Date.now()
			if (now - last < INTERVAL) return
			last = now
			touch()
		},
		{ scope: 'document', source: 'user' }
	)
	return () => {
		unlisten()
		touch()
	}
}
