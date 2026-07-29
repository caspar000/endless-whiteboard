import { memo } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Rendered markdown. `react-markdown` builds React elements rather than assigning `innerHTML`, and
 * raw HTML in the source is *not* enabled (no `rehype-raw`), so there is no HTML-injection surface
 * to sanitise. GFM gives the tables, task lists and strikethrough that real notes contain.
 */
export const MarkdownView = memo(function MarkdownView({ md }: { md: string }) {
	return (
		<div className="lb-md__body">
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
		</div>
	)
})
