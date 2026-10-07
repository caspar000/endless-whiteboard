import type { VecLike } from '../../primitives/Vec2d'
import type { Editor } from '../Editor'
import type { TLShape } from './shape-types'
import { SerializedSchema } from '@tldraw/store'
import {
	TLAsset,
	TLShapeId,
} from '@tldraw/tlschema'

/** @public */
export interface TLContent {
	shapes: TLShape[]
	rootShapeIds: TLShapeId[]
	assets: TLAsset[]
	schema: SerializedSchema
}

/**
 * The clipboard as it arrived, before the canvas has made anything of it: what `onClipboardPasteRaw`
 * is given (docs/fork-parity.md X2). Read from a paste event or the clipboard API alike.
 *
 * @public
 */
export interface TLClipboardRaw {
	/** The kinds on it, as MIME types: `text/plain`, `text/html`, `image/png`… */
	types: readonly string[]
	/** One kind's contents as text, or `null` when it isn't there. */
	getText(type: string): Promise<string | null>
	/** The files and pictures on it. */
	getFiles(): Promise<Blob[]>
}

/**
 * Hooks into copy and paste, set in the editor's options (docs/fork-parity.md X2).
 *
 * @public
 */
export interface TLClipboardHooks {
	/**
	 * Before a copy or a cut writes shapes to the clipboard. Return the content to write instead, or
	 * `null` to write nothing (a cut then deletes nothing either); return nothing to leave it as it is.
	 */
	onBeforeCopyToClipboard?(
		info: { editor: Editor; operation: 'copy' | 'cut' },
		content: TLContent
	): TLContent | null | void
	/**
	 * Before pasted shapes (from this app, or converted from Excalidraw) go onto the page. Return the
	 * content to put instead, or `null` to put nothing; return nothing to leave it as it is.
	 */
	onBeforePasteFromClipboard?(
		info: { editor: Editor; point?: VecLike },
		content: TLContent
	): TLContent | null | void
	/**
	 * Before the canvas reads a paste at all. Return `false` to say it's been handled, and the canvas
	 * does nothing more with it.
	 */
	onClipboardPasteRaw?(info: {
		editor: Editor
		clipboard: TLClipboardRaw
		point?: VecLike
	}): boolean | void | Promise<boolean | void>
}
