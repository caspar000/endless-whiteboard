import { Check, Copy } from 'lucide-react'
import { memo, useEffect, useState, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'

/**
 * A reply, rendered as the markdown it actually is.
 *
 * The panel used to print the model's text into a `pre-wrap` div, which is honest about the
 * characters and wrong about the content: a model writes lists, headings, `code` and tables, and
 * showing the asterisks makes a structured answer harder to read than an unstructured one. This is
 * the same treatment T3 Code gives a message — GFM for tables and task lists, `remark-breaks` so a
 * single newline is a line break, and a copy button on every fenced block.
 *
 * Raw HTML is deliberately not enabled (no `rehype-raw`), which is what makes sanitising unnecessary:
 * `react-markdown` builds React elements rather than assigning `innerHTML`, so there is no injection
 * surface for a model — or a web page it quoted — to reach through. Same reasoning as
 * `note-markdown`'s `MarkdownView`, and it matters more here, because this text came off the internet.
 */
export const AgentMarkdown = memo(function AgentMarkdown({
	text,
	breaks = false,
}: {
	text: string
	/**
	 * Treat a single newline as a line break.
	 *
	 * **On for what a person typed, off for what the model wrote** — T3 Code splits it the same way and
	 * the difference matters. A person's newline is where they pressed Enter; a model's is prose
	 * wrapping at some column it chose, and honouring those turns a paragraph into a ragged stack of
	 * short lines.
	 */
	breaks?: boolean
}) {
	return (
		<div className="lb-agent-md">
			<Markdown
				remarkPlugins={breaks ? [remarkGfm, remarkBreaks] : [remarkGfm]}
				components={{
					/**
					 * `pre` rather than `code` is where the block chrome goes: the language class lives on
					 * the inner `code`, but the copy button has to sit outside the scrolling region or it
					 * scrolls away with a long line.
					 */
					pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
					// GFM tables overflow a 360px column constantly, so each gets its own scroller rather
					// than widening the panel or wrapping cells into unreadability.
					table: ({ children }) => (
						<div className="lb-agent-md__table">
							<table>{children}</table>
						</div>
					),
					/**
					 * Links open in a new tab, and only ever `http(s)`.
					 *
					 * The agent can search the web, so these are third-party URLs it chose — a `javascript:`
					 * href would be a script the model got to run in the app, and `target="_blank"` without
					 * `noreferrer` hands the opened page a handle on this window.
					 */
					a: ({ children, href }) => {
						const safe = typeof href === 'string' && /^https?:\/\//i.test(href)
						return safe ? (
							<a href={href} target="_blank" rel="noreferrer noopener">
								{children}
							</a>
						) : (
							<span>{children}</span>
						)
					},
					// GFM renders a task item's box as a disabled input. It stays disabled: this is a
					// transcript of what was said, not a checklist the user owns.
					input: (props) => <input {...props} disabled readOnly />,
				}}
			>
				{text}
			</Markdown>
		</div>
	)
})

/**
 * A fenced code block, with the copy button T3 Code puts on one.
 *
 * The language is not read off the class and shown as a header here — in a board panel the fenced
 * content is usually a JSON blob or a snippet the agent is quoting back, and a `json` label above a
 * three-line block spends more of a narrow column on chrome than on content. The button is the part
 * that earns its space.
 */
function CodeBlock({ children }: { children: ReactNode }) {
	return (
		<div className="lb-agent-md__code">
			<CopyButton
				className="lb-agent-md__code-copy"
				// Read from the DOM at click time rather than reassembled from React children: children
				// here are already-rendered elements (`code` wrapping text and possibly `span`s), and
				// walking them back into a string re-implements `textContent` badly.
				text={(event) => event.currentTarget.closest('.lb-agent-md__code')?.querySelector('code')?.textContent ?? ''}
			/>
			<pre>{children}</pre>
		</div>
	)
}

/**
 * Copy, with the tick that says it worked.
 *
 * `text` may be a string or a function of the click, because the two callers differ: a whole message
 * has its text to hand, and a code block has to read the block it is inside.
 */
export function CopyButton({
	text,
	className,
	label = 'Copy',
}: {
	text: string | ((event: React.MouseEvent<HTMLButtonElement>) => string)
	className?: string
	label?: string
}) {
	const [copied, setCopied] = useState(false)

	useEffect(() => {
		if (!copied) return
		const timer = setTimeout(() => setCopied(false), 1400)
		return () => clearTimeout(timer)
	}, [copied])

	return (
		<button
			type="button"
			className={className ? `lb-agent-copy ${className}` : 'lb-agent-copy'}
			title={copied ? 'Copied' : label}
			aria-label={label}
			onClick={(event) => {
				const value = typeof text === 'function' ? text(event) : text
				if (!value) return
				// No error branch: `writeText` rejects when the document is not focused, and a click just
				// focused it. A failure here leaves the tick unshown, which is the right signal anyway.
				void navigator.clipboard?.writeText(value).then(() => setCopied(true))
			}}
		>
			{copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
		</button>
	)
}
