import { Editor, TLSvgOptions } from '@lifeboard/canvas-editor'

/** Export options with the pixels per page unit a picture is drawn at. @public */
export type TLExportOptions = Partial<TLSvgOptions> & { pixelRatio?: number }

/**
 * What an export or a copy is drawn with unless told otherwise: the board's background choice, and
 * the person's pixel density and trim (docs/fork-parity.md X4).
 */
export function getExportOptions(editor: Editor): TLExportOptions {
	return {
		scale: 1,
		background: editor.getInstanceState().exportBackground,
		pixelRatio: editor.user.getExportPixelRatio(),
		...(editor.user.getIsExportTrimmed() && { padding: 'auto' as const }),
	}
}
