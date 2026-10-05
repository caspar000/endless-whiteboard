import type { TLEditorComponents } from '@lifeboard/canvas-editor'
import { createContext, useContext, type ComponentType, type ReactNode } from 'react'

/** What the `ContextMenu` slot gets: the canvas to attach to, and the menu's items. @public */
export interface TLUiContextMenuProps {
	canvas?: ReactNode
	children?: ReactNode
}

/** What the `KeyboardShortcutsDialog` slot gets. @public */
export interface TLUiKeyboardShortcutsDialogProps {
	onClose(): void
	children?: ReactNode
}

/**
 * Parts of the UI an app can replace (or remove, with `null`) through `<Tldraw components>`, next to
 * the editor's own slots.
 *
 * @public
 */
export interface TLUiComponents {
	ContextMenu?: ComponentType<TLUiContextMenuProps> | null
	KeyboardShortcutsDialog?: ComponentType<TLUiKeyboardShortcutsDialogProps> | null
	/** The top-left menus: main menu, pages, undo and redo. */
	MenuPanel?: ComponentType | null
	StylePanel?: ComponentType | null
	Toolbar?: ComponentType | null
	/** Standalone image and video toolbars. The fork draws none by default. */
	ImageToolbar?: ComponentType | null
	VideoToolbar?: ComponentType | null
}

/**
 * Every slot `<Tldraw components>` takes: the editor's and the UI's.
 *
 * @public
 */
export type TLComponents = TLEditorComponents & TLUiComponents

const TldrawUiComponentsContext = createContext<TLUiComponents>({})

/** @internal */
export const TldrawUiComponentsProvider = TldrawUiComponentsContext.Provider

/** The UI slots an app has replaced; `undefined` means the default, `null` means none. @public */
export function useTldrawUiComponents(): TLUiComponents {
	return useContext(TldrawUiComponentsContext)
}
