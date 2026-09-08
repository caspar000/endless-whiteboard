/**
 * What a page says about itself.
 *
 * The one definition in the workspace: node-kit's `NetworkBridge` and the app's `PlatformAdapter`
 * both type-import it from here rather than growing structural copies, which is only safe because
 * this package has no dependencies at all — importing the type cannot drag anything into a bundle.
 *
 * Every field is a plain string and `''` means "the page did not say". Nothing here is ever a
 * *guess*: an empty `image` renders as no image, whereas a wrong one renders as a broken image, and
 * the second is what this whole package exists to stop happening.
 */
export interface LinkPreview {
	/** The final URL, after redirects — what the metadata below actually describes. */
	url: string
	title: string
	description: string
	/** Absolute URL of the preview image, or `''`. */
	image: string
	/** Absolute URL of the site icon, or `''`. */
	favicon: string
	siteName: string
}

/** An empty preview for `url` — the shape callers fall back to, with nothing invented. */
export function emptyLinkPreview(url: string): LinkPreview {
	return { url, title: '', description: '', image: '', favicon: '', siteName: '' }
}
