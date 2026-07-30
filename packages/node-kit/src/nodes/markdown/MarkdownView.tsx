import { memo } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Rendered markdown. `react-markdown` builds React elements rather than assigning `innerHTML`, and
 * raw HTML in the source is *not* enabled (no `rehype-raw`), so there is no HTML-injection surface
 * to sanitise. GFM gives the tables, task lists and strikethrough that real notes contain.
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
				remarkPlugins={[remarkGfm]}
				components={{
					// Links are shown but inert: a click inside a shape belongs to the canvas, and a
					// navigation away from the board would lose the editing context.
					a: ({ children, href }) => (
						<span className="lb-md__link" title={href}>
							{children}
						</span>
					),
				}}
		>
			{md}
		</Markdown>
	)

	return bare ? content : <div className="lb-md__body">{content}</div>
})
