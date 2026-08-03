import { memo } from 'react'
import Markdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { useImageOrVideoAsset, type TLAssetId } from 'tldraw'

/**
 * Rendered markdown. `react-markdown` builds React elements rather than assigning `innerHTML`, and
 * raw HTML in the source is *not* enabled (no `rehype-raw`), so there is no HTML-injection surface
 * to sanitise. GFM gives the tables, task lists and strikethrough that real notes contain.
 *
 * `remark-breaks` makes a single newline render as a line break, which is Obsidian's default and is
 * what makes "Enter always starts a new line" true. Without it CommonMark folds a lone newline into a
 * space, so pressing Enter would insert something invisible and the note would not grow.
 */
export const MarkdownView = memo(function MarkdownView({
	md,
	bare = false,
}: {
	md: string
	/**
	 * Render without the `.lb-md__body` wrapper. The live-preview editor renders one block at a time
	 * inside a single outer body element, so nesting a wrapper per block would both duplicate the
	 * padding and make `.lb-md__body h1` match more than once.
	 */
	bare?: boolean
}) {
	const content = (
		<Markdown
			remarkPlugins={[remarkGfm, remarkBreaks]}
			components={{
				// Links are shown but inert: a click inside a shape belongs to the canvas, and a
				// navigation away from the board would lose the editing context.
				a: ({ children, href }) => (
					<span className="lb-md__link" title={href}>
						{children}
					</span>
				),
				// `![](asset:…)` has to resolve against the board's own asset store — that is the form
				// the item→note migration writes, so without this every migrated photo would render as
				// a broken image.
				img: ({ src, alt }) => <MarkdownImage src={typeof src === 'string' ? src : ''} alt={alt} />,
			}}
		>
			{md}
		</Markdown>
	)

	return bare ? content : <div className="lb-md__body">{content}</div>
})

/**
 * An image inside a note.
 *
 * A tldraw asset id (`asset:…`) is resolved through `useImageOrVideoAsset`, which keeps resolution
 * inside tldraw — node-kit must not reach for storage itself (§4.5, the `platform/`-only rule), and
 * this way a future remote asset store works with no change here.
 *
 * The trade-off the migration accepted: markdown holding a tldraw asset id is not portable outside the
 * app. A future export would have to rewrite these to real files.
 */
function MarkdownImage({ src, alt }: { src: string; alt?: string }) {
	const isAssetId = src.startsWith('asset:')
	// Called unconditionally — hooks cannot be conditional. A null assetId simply resolves to nothing.
	const { url } = useImageOrVideoAsset({
		assetId: isAssetId ? (src as TLAssetId) : null,
		// Shape-space width. Notes are narrow, and this only picks which resolution to request.
		width: 320,
	})

	const resolved = isAssetId ? url : src
	if (!resolved) return null
	return <img className="lb-md__img" src={resolved} alt={alt ?? ''} />
}
