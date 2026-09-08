import {
	createNodeShape,
	encodeLinkValue,
	getNetworkBridge,
	linkHost,
	mergeProperties,
	normalizeUrl,
	propertyIdFromName,
	updateShapeProperties,
	type ContentImport,
	type ContentImportContext,
	type PropertyDef,
} from '@lifeboard/node-kit'
import type { TLShapeId } from 'tldraw'
import { noteNodeDefinition } from './definition'

/**
 * Dropping a link makes a note that carries it.
 *
 * tldraw already turns a dropped URL into a bookmark card, and a card is the wrong thing *here*: it
 * cannot hold a property, be counted by a table, stand on a calendar or answer an expression, which
 * is most of what content is for in this app. A note with a `Link` property can do all of those, and
 * it is still a link you can click.
 *
 * **The title arrives in two steps.** The note is written immediately, titled with the host —
 * `figma.com`, `en.wikipedia.org` — because a paste has to land the instant you paste it and because
 * the host is never wrong. Then the page is asked what it calls itself, and if it answers, the title
 * is replaced in place. Reading a page's own `<title>` cross-origin is not something a browser can
 * do (see `NetworkBridge.unfurl`), so that second step needs a host willing to answer and silently
 * does nothing when there isn't one — which is why the first step has to be worth keeping on its own.
 */
const LINK_PROPERTY: PropertyDef = {
	id: propertyIdFromName('Link'),
	name: 'Link',
	type: 'link',
}

/** The note's one line of prose. Also the shape of what we later check hasn't been edited. */
function linkMarkdown(title: string, url: string): string {
	return `[${title}](${url})`
}

/**
 * Swaps the host for the page's real title, once it is known.
 *
 * Three things it refuses to do, all of them the difference between a nice touch and an infuriating
 * one:
 *
 * - **Overwrite an edit.** If the note's text is no longer exactly what was written a moment ago,
 *   someone has typed in it, and their words outrank a title that arrived late.
 * - **Cost an undo.** `history: 'ignore'` keeps this out of the stack: ⌘Z after pasting a link must
 *   remove the note, not silently rename it and leave you pressing it again.
 * - **Resurrect a deleted note.** The shape is looked up again rather than captured, because several
 *   seconds is long enough to paste, think better of it, and delete.
 */
function applyTitle(
	editor: ContentImportContext['editor'],
	id: TLShapeId,
	url: string,
	title: string
): void {
	// The literal rather than `noteNodeDefinition.type`, which the definition's annotation widens to
	// `string`: this is what narrows the shape to a note and gives `props.md` a type. It is the same
	// literal `shape-types.ts` registers with tldraw's shape map.
	const shape = editor.getShape(id)
	if (shape?.type !== 'node.markdown') return
	if (shape.props.md !== linkMarkdown(linkHost(url) || url, url)) return

	editor.run(
		() => {
			editor.updateShapes([{ id, type: shape.type, props: { md: linkMarkdown(title, url) } }])
			const updated = editor.getShape(id)
			if (updated) {
				updateShapeProperties(editor, updated, {
					[LINK_PROPERTY.id]: encodeLinkValue({ title, url }),
				})
			}
		},
		{ history: 'ignore' }
	)
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
		const host = linkHost(url) || url

		let id: TLShapeId | undefined
		editor.run(() => {
			editor.markHistoryStoppingPoint('drop link')
			// The definition has to reach the board before a value referencing it does, or the note
			// would carry an id the board cannot name (see the property sidecar in values.ts).
			mergeProperties(editor, [LINK_PROPERTY])
			id = createNodeShape(editor, noteNodeDefinition as never, point, {
				// The link is in the prose *as well*, because a note whose text was empty would look
				// like a mistake — and markdown's link syntax is what the property stores anyway.
				md: linkMarkdown(host, url),
			})
			const shape = editor.getShape(id)
			if (shape) {
				updateShapeProperties(editor, shape, {
					[LINK_PROPERTY.id]: encodeLinkValue({ title: host, url }),
				})
			}
			editor.select(id)
		})

		/*
		 * Not awaited, deliberately. Whoever answers `unfurl` is fetching a page over the network,
		 * and a paste that sat still for several seconds waiting on that would be a worse feature
		 * than no titles at all. The note is already on the board; this only improves it.
		 */
		const noteId = id
		if (!noteId) return
		void getNetworkBridge()
			?.unfurl(url)
			.then((preview) => {
				if (preview?.title) applyTitle(editor, noteId, url, preview.title)
			})
			.catch(() => {
				// The bridge promises not to throw. If one ever does, the note keeps its host title.
			})
	},
}
