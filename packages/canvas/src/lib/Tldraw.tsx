import type { ComponentType } from 'react'
import {
	TldrawEditorStoreProps,
	Canvas,
	Editor,
	ErrorScreen,
	LoadingScreen,
	StoreSnapshot,
	TLOnMountHandler,
	TLRecord,
	TLStore,
	TLStoreWithStatus,
	TldrawEditor,
	TldrawEditorBaseProps,
	TldrawEditorProps,
	assert,
	useEditor,
	useShallowArrayIdentity,
	useShallowObjectIdentity,
	TLStateNodeConstructor,
} from '@lifeboard/canvas-editor'
import { useCallback, useDebugValue, useLayoutEffect, useMemo, useRef } from 'react'
import { TldrawHandles } from './canvas/TldrawHandles'
import { TldrawHoveredShapeIndicator } from './canvas/TldrawHoveredShapeIndicator'
import { TldrawScribble } from './canvas/TldrawScribble'
import { TldrawSelectionBackground } from './canvas/TldrawSelectionBackground'
import { TldrawSelectionForeground } from './canvas/TldrawSelectionForeground'
import {
	TLExternalContentProps,
	registerDefaultExternalContentHandlers,
} from './defaultExternalContentHandlers'
import { defaultShapeTools } from './defaultShapeTools'
import { defaultBindingUtils } from './defaultBindingUtils'
import { defaultShapeUtils } from './defaultShapeUtils'
import { registerDefaultSideEffects } from './defaultSideEffects'
import { defaultTools } from './defaultTools'
import { TldrawUi, TldrawUiProps } from './ui/TldrawUi'
import { DefaultContextMenu } from './ui/components/ContextMenu'
import { TLComponents, TLUiContextMenuProps } from './ui/hooks/useTldrawUiComponents'
import { usePreloadAssets } from './ui/hooks/usePreloadAssets'
import { useDefaultEditorAssetsWithOverrides } from './utils/static-assets/assetUrls'

/** @public */
export type TldrawProps = TldrawEditorBaseProps &
	TldrawEditorStoreProps &
	TldrawUiProps &
	Partial<TLExternalContentProps>

/** @public */
export function Tldraw(props: TldrawProps) {
	const {
		children,
		maxImageDimension,
		maxAssetSize,
		acceptedImageMimeTypes,
		acceptedVideoMimeTypes,
		onMount,
		...rest
	} = props

	const components = useShallowObjectIdentity(
		(rest.components ?? {}) as Record<string, unknown>
	) as TLComponents
	const shapeUtils = useShallowArrayIdentity(rest.shapeUtils ?? [])
	const bindingUtils = useShallowArrayIdentity(rest.bindingUtils ?? [])
	const tools = useShallowArrayIdentity(rest.tools ?? [])

	const withDefaults: TldrawEditorProps & { components: TLComponents } = {
		initialState: 'select',
		...rest,
		components: useMemo(
			() => ({
				Scribble: TldrawScribble,
				CollaboratorScribble: TldrawScribble,
				SelectionForeground: TldrawSelectionForeground,
				SelectionBackground: TldrawSelectionBackground,
				Handles: TldrawHandles,
				HoveredShapeIndicator: TldrawHoveredShapeIndicator,
				...components,
			}),
			[components]
		),
		shapeUtils: useMemo(() => replacingDefaults('type', defaultShapeUtils, shapeUtils), [shapeUtils]),
		bindingUtils: useMemo(() => replacingDefaults('type', defaultBindingUtils, bindingUtils), [bindingUtils]),
		tools: useMemo(() => replacingDefaults<'id', TLStateNodeConstructor>('id', [...defaultTools, ...defaultShapeTools], tools), [tools]),
	}

	const assets = useDefaultEditorAssetsWithOverrides(rest.assetUrls)

	const { done: preloadingComplete, error: preloadingError } = usePreloadAssets(assets)

	if (preloadingError) {
		return <ErrorScreen>Could not load assets. Please refresh the page.</ErrorScreen>
	}

	if (!preloadingComplete) {
		return <LoadingScreen>Loading assets...</LoadingScreen>
	}

	return (
		<TldrawEditor {...withDefaults}>
			<TldrawUi {...withDefaults}>
				<CanvasWithContextMenu ContextMenu={components.ContextMenu} />
				<InsideOfEditorContext
					maxImageDimension={maxImageDimension}
					maxAssetSize={maxAssetSize}
					acceptedImageMimeTypes={acceptedImageMimeTypes}
					acceptedVideoMimeTypes={acceptedVideoMimeTypes}
					onMount={onMount}
				/>
				{children}
			</TldrawUi>
		</TldrawEditor>
	)
}

/**
 * The defaults plus the app's own, where one of the app's takes the place of a default with the same
 * `type` (utils) or `id` (tools), as today's tldraw does. Lifeboard replaces the frame util so.
 */
function replacingDefaults<K extends 'type' | 'id', T extends { [key in K]: string }>(
	key: K,
	defaults: readonly T[],
	custom: readonly T[]
): T[] {
	const replaced = new Set(custom.map((item) => item[key]))
	return [...defaults.filter((item) => !replaced.has(item[key])), ...custom]
}

/** The canvas, inside the context menu slot (or on its own when an app removes the menu). */
function CanvasWithContextMenu({
	ContextMenu,
}: {
	ContextMenu: ComponentType<TLUiContextMenuProps> | null | undefined
}) {
	if (ContextMenu === null) return <Canvas />
	const Menu = ContextMenu ?? DefaultContextMenu
	return <Menu canvas={<Canvas />} />
}

// We put these hooks into a component here so that they can run inside of the context provided by TldrawEditor.
function InsideOfEditorContext({
	// As today's tldraw: only very large images are scaled down here; an app's asset store can do its own.
	maxImageDimension = 5000,
	maxAssetSize = 10 * 1024 * 1024, // 10mb
	acceptedImageMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/svg+xml'],
	acceptedVideoMimeTypes = ['video/mp4', 'video/quicktime'],
	onMount,
}: Partial<TLExternalContentProps & { onMount: TLOnMountHandler }>) {
	const editor = useEditor()

	const onMountEvent = useEvent((editor: Editor) => {
		const unsubs: (void | (() => void) | undefined)[] = []

		unsubs.push(...registerDefaultSideEffects(editor))

		// for content handling, first we register the default handlers...
		registerDefaultExternalContentHandlers(editor, {
			maxImageDimension,
			maxAssetSize,
			acceptedImageMimeTypes,
			acceptedVideoMimeTypes,
		})

		// ...then we run the onMount prop, which may override the above
		unsubs.push(onMount?.(editor))

		return () => {
			unsubs.forEach((fn) => fn?.())
		}
	})

	useLayoutEffect(() => {
		if (editor) return onMountEvent?.(editor)
	}, [editor, onMountEvent])

	return null
}

// duped from tldraw editor
function useEvent<Args extends Array<unknown>, Result>(
	handler: (...args: Args) => Result
): (...args: Args) => Result {
	const handlerRef = useRef<((...args: Args) => Result) | undefined>(undefined)

	useLayoutEffect(() => {
		handlerRef.current = handler
	})

	useDebugValue(handler)

	return useCallback((...args: Args) => {
		const fn = handlerRef.current
		assert(fn, 'fn does not exist')
		return fn(...args)
	}, [])
}
