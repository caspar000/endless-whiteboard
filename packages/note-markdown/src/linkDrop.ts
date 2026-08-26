import {
	createNodeShape,
	encodeLinkValue,
	linkHost,
	mergeProperties,
	normalizeUrl,
	propertyIdFromName,
	updateShapeProperties,
	type ContentImport,
	type ContentImportContext,
	type PropertyDef,
} from '@lifeboard/node-kit'
import { noteNodeDefinition } from './definition'

/**
 * Dropping a link makes a note that carries it.
 *
 * tldraw already turns a dropped URL into a bookmark card, and a card is the wrong thing *here*: it
 * cannot hold a property, be counted by a table, stand on a calendar or answer an expression, which
 * is most of what content is for in this app. A note with a `Link` property can do all of those, and
 * it is still a link you can click.
 *
 * No network. The obvious next step is to fetch the page title, and it would need a server: a browser
 * cannot read `<title>` cross-origin, which is why tldraw's own bookmark card asks a backend for its
 * metadata. So the title is the host — `figma.com`, `en.wikipedia.org` — which is honest, instant,
 * and the same thing you would have called it anyway. Nothing about the shape of this changes when a
 * real title arrives later; it is one more write to the same property.
 */
const LINK_PROPERTY: PropertyDef = {
	id: propertyIdFromName('Link'),
	name: 'Link',
	type: 'link',
}

export const linkDropImport: ContentImport = {
	/**
	 * Only something that is unambiguously a URL and nothing else.
	 *
	 * `normalizeUrl` would happily read "notes.txt" as a hostname — it assumes the web's default
	 * scheme, which is right when someone is *typing a link into a field* and wrong when deciding
	 * whether a paragraph they pasted was one. So a scheme is required here, and a single token: text
	 * with a link in the middle of it is prose, and prose is tldraw's text shape.
	 */
	matches(text) {
		const trimmed = text.trim()
		if (!trimmed || /\s/.test(trimmed)) return false
		if (!/^https?:\/\//i.test(trimmed)) return false
		return normalizeUrl(trimmed) !== null
	},

	async onText({ editor, text, point }: ContentImportContext) {
		const url = normalizeUrl(text.trim())
		if (!url) return
		const title = linkHost(url) || url

		editor.run(() => {
			editor.markHistoryStoppingPoint('drop link')
			// The definition has to reach the board before a value referencing it does, or the note
			// would carry an id the board cannot name (see the property sidecar in values.ts).
			mergeProperties(editor, [LINK_PROPERTY])
			const id = createNodeShape(editor, noteNodeDefinition as never, point, {
				// The link is in the prose *as well*, because a note whose text was empty would look
				// like a mistake — and markdown's link syntax is what the property stores anyway.
				md: `[${title}](${url})`,
			})
			const shape = editor.getShape(id)
			if (shape) {
				updateShapeProperties(editor, shape, {
					[LINK_PROPERTY.id]: encodeLinkValue({ title, url }),
				})
			}
			editor.select(id)
		})
	},
}
