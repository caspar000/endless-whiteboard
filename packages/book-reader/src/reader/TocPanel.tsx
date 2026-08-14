import type { TocItem } from './types'

/**
 * The book's own table of contents, as a side panel.
 *
 * Both engines can produce one (pdf.js's outline, an EPUB's nav document), and both produce it as a
 * tree — flattened to a depth-indented list here, because a reader's outline is something you scan
 * and click, not a structure you manage.
 */
export function TocPanel({
	items,
	onNavigate,
	onClose,
}: {
	items: readonly TocItem[]
	onNavigate(target: string): void
	onClose(): void
}) {
	return (
		<aside className="lb-reader__toc" aria-label="Contents">
			{items.length === 0 ? (
				// Plenty of books have no navigation document, and scanned PDFs almost never do.
				<p className="lb-reader__toc-empty">This book has no table of contents.</p>
			) : (
				<ul className="lb-reader__toc-list">
					{items.map((item, index) => (
						<li key={`${item.target}-${index}`}>
							<button
								type="button"
								className="lb-reader__toc-item"
								style={{ paddingLeft: 10 + item.depth * 14 }}
								onClick={() => {
									onNavigate(item.target)
									onClose()
								}}
							>
								{item.label}
							</button>
						</li>
					))}
				</ul>
			)}
		</aside>
	)
}
