import { linkHost, type LinkPreview } from '@lifeboard/node-kit'
import { AssetRecordType, getHashForString, type Editor, type TLBookmarkAsset } from 'tldraw'

/**
 * The bookmark card's metadata, read properly.
 *
 * **The bug this replaces.** tldraw's default handler fetches the page with `mode: 'no-cors'`, which
 * can only ever return an *opaque* response — a body a tab is not allowed to read. `resp.text()` is
 * therefore always `''`, no `og:` tag is ever found, and the handler then treats the resulting empty
 * image as a *relative URL* and resolves it against the page: `new URL('', pageUrl)` is the page. So
 * every bookmark got the HTML document as its `<img src>` and drew a broken image, with the raw URL
 * as its title because that fallback fired too. It is not a network failure and no amount of
 * retrying fixes it — the fetch cannot succeed from a browser at all.
 *
 * **What happens instead.** The platform is asked (`PlatformAdapter.unfurl`), which routes to a
 * same-origin endpoint that a *server* answers. When it can, the card gets a real title, description
 * and preview image. When it can't — plain static hosting, offline, a page with no metadata — the
 * asset says so honestly: no image, no favicon guess of our own, and the host as the title. tldraw
 * renders that as its short card, which is a small tidy thing rather than a broken one.
 *
 * The asset id has to be `AssetRecordType.createId(getHashForString(url))`: the bookmark shape
 * derives that id from its own URL to find its asset (`getResolvedBookmarkAssetId`), so an id
 * generated any other way leaves the card looking permanently unhydrated.
 */
export function bookmarkAssetFor(url: string, preview: LinkPreview | null): TLBookmarkAsset {
	return {
		id: AssetRecordType.createId(getHashForString(url)),
		typeName: 'asset',
		type: 'bookmark',
		props: {
			src: url,
			// The host, not the URL. It is what the page would have been called in conversation, it
			// fits on one line, and it is never a lie — where tldraw's fallback printed the whole
			// address in heading type and called it a title.
			title: preview?.title || linkHost(url) || url,
			description: preview?.description ?? '',
			// Empty unless the page actually named an image. This is the whole fix: absent has to
			// stay absent, because tldraw draws a card with no image differently from one whose
			// image fails to load.
			image: preview?.image ?? '',
			favicon: preview?.favicon ?? '',
		},
		meta: {},
	}
}

/**
 * Replaces tldraw's `url` asset handler for the editor it is given.
 *
 * Registered from a component mounted *inside* `<Tldraw>`, like the content handlers in
 * `FileImportHandler` and for the same reason: children mount after tldraw registers its own
 * defaults, and only one handler per type survives.
 *
 * Never throws and never returns `undefined`. A bookmark shape whose asset never arrives sits at
 * full height with an empty frame forever, so "we found nothing" still has to produce an asset.
 */
export function registerBookmarkAssetHandler(
	editor: Editor,
	unfurl: (url: string) => Promise<LinkPreview | null>
): void {
	editor.registerExternalAssetHandler('url', async ({ url }) => {
		let preview: LinkPreview | null = null
		try {
			preview = await unfurl(url)
		} catch {
			// The adapter promises not to throw; if a future one forgets, a plain card is still a
			// better outcome than a bookmark that never resolves.
			preview = null
		}
		return bookmarkAssetFor(url, preview)
	})
}
