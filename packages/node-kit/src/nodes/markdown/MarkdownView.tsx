import { memo, useRef } from 'react'
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
	onToggleTask,
	taskIndexOffset = 0,
}: {
	md: string
	/**
	 * Render without the `.lb-md__body` wrapper. The live-preview editor renders one block at a time
	 * inside a single outer body element, so nesting a wrapper per block would both duplicate the
	 * padding and make `.lb-md__body h1` match more than once.
	 */
	bare?: boolean
	/**
	 * Called with a task's index in document order when its checkbox is clicked. Omit to render
	 * checkboxes read-only.
	 *
	 * Ticking a box has to rewrite the markdown, because the markdown *is* the model — see `tasks.ts`.
	 */
	onToggleTask?: (index: number) => void
	/**
	 * Added to the index reported by `onToggleTask`.
	 *
	 * The live-preview editor renders the document in two pieces around the line being edited, so the
	 * second piece's first checkbox is not the document's first. Without the offset, clicking a box below
	 * the caret would tick one above it.
	 */
	taskIndexOffset?: number
}) {
	const rootRef = useRef<HTMLDivElement>(null)

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
				// GFM renders a task item's checkbox as a *disabled* `<input>`. Enabling it — and working
				// out *which* task it is from its position among its siblings — is what makes a note's
				// checklist usable without first entering the editor.
				input: (props) =>
					props.type === 'checkbox' && onToggleTask ? (
						<input
							type="checkbox"
							className="lb-md__task"
							checked={props.checked === true}
							// The index is read from the DOM at click time rather than counted during render:
							// DOM order *is* document order, guaranteed, whereas a render-time counter breaks
							// under StrictMode's double render.
							onChange={(e) => {
								const root = rootRef.current
								if (!root) return
								const boxes = [...root.querySelectorAll('input.lb-md__task')]
								const index = boxes.indexOf(e.currentTarget)
								if (index >= 0) onToggleTask(index + taskIndexOffset)
							}}
							// The shape swallows pointer events in display mode, and the editor's preview
							// regions move the caret on click. Neither should happen when the target is a box.
							onPointerDown={(e) => e.stopPropagation()}
							onClick={(e) => e.stopPropagation()}
						/>
					) : (
						<input {...props} />
					),
			}}
		>
			{md}
		</Markdown>
	)

	// The wrapper is always present when tasks are interactive: the click handler needs a root to scope
	// its query to, or two notes on screen would share one checkbox ordering.
	return bare && !onToggleTask ? (
		content
	) : (
		<div className={bare ? 'lb-md__bare' : 'lb-md__body'} ref={rootRef}>
			{content}
		</div>
	)
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
