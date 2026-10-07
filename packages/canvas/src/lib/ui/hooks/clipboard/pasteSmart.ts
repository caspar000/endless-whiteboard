import { Editor, TLExternalContentSource, VecLike } from '@lifeboard/canvas-editor'
import { getEmbedInfo } from '../../../utils/embeds/embeds'
import { pasteUrl } from './pasteUrl'

/**
 * What a paste of text can be besides text (docs/fork-parity.md B8): a site's embed code, and a link
 * meant for the shapes already selected. Mermaid has its own file (../../../utils/mermaid).
 */

/** Shapes whose `url` is a link on them, not what they are (a bookmark's or an embed's is). */
const LINKABLE = new Set(['geo', 'note', 'pinned-note', 'image', 'video'])

/**
 * A URL pasted while shapes that can carry a link are selected (and nothing else is) becomes their
 * link, rather than a card of its own. Returns whether it did.
 */
export function pasteLinkOntoSelection(editor: Editor, url: string): boolean {
	const selected = editor.getSelectedShapes()
	if (!selected.length || editor.getEditingShapeId()) return false
	if (!selected.every((shape) => LINKABLE.has(shape.type) && 'url' in shape.props)) return false
	if (selected.some((shape) => editor.isShapeOrAncestorLocked(shape))) return false
	editor.mark('paste link')
	editor.updateShapes(selected.map(({ id, type }) => ({ id, type, props: { url } })))
	return true
}

/** The source and size of embed code that is one `<iframe>` and nothing else, or `null`. */
export function getPastedIframe(text: string): { src: string; width?: number; height?: number } | null {
	const trimmed = text.trim()
	if (!/^<iframe[\s>]/i.test(trimmed)) return null
	const body = new DOMParser().parseFromString(trimmed, 'text/html').body
	const iframe = body.firstElementChild
	if (body.children.length !== 1 || iframe?.tagName !== 'IFRAME' || body.textContent?.trim()) return null
	const src = iframe.getAttribute('src') ?? ''
	try {
		if (!/^https?:$/.test(new URL(src).protocol)) return null
	} catch {
		return null
	}
	// Pixels only: a percentage means "as wide as the page it's on", which a board doesn't have.
	const size = (name: string) => {
		const value = iframe.getAttribute(name) ?? ''
		return /^\d+(\.\d+)?(px)?$/.test(value.trim()) ? parseFloat(value) : undefined
	}
	return { src, width: size('width'), height: size('height') }
}

/**
 * Embed code pasted: an embed of the site, at the size the code asks for, when it's one the board can
 * embed; a link card for its address otherwise (an arbitrary page is not run on the board).
 */
export function pasteIframe(
	editor: Editor,
	{ src, width, height }: NonNullable<ReturnType<typeof getPastedIframe>>,
	point?: VecLike,
	sources?: TLExternalContentSource[]
) {
	const embed = getEmbedInfo(src)
	if (!embed) return pasteUrl(editor, src, point, sources)
	editor.mark('paste')
	return editor.putExternalContent({
		type: 'embed',
		url: embed.url,
		point,
		embed: {
			...embed.definition,
			width: width ?? embed.definition.width,
			height: height ?? embed.definition.height,
		},
	})
}
