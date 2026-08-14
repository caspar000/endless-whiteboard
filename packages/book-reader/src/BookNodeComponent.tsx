import { useAssetUrl, type NodeComponentProps } from '@lifeboard/node-kit'
import { memo, useSyncExternalStore } from 'react'
import { BookFilePicker } from './BookFilePicker'
import type { BookNodeProps } from './definition'
import { MetadataPicker } from './enrich/MetadataPicker'
import { getEnrichTarget, subscribeToEnrichTarget } from './enrich/enrichTarget'
import { BookReaderOverlay } from './reader/BookReaderOverlay'

/**
 * The book card: the cover, or a typographic jacket when there isn't one (yet). That is the whole
 * card — its data, reading progress included, is drawn *under* the shape by the app
 * (`strips: 'below'` on the definition), exactly as it is for a sticky note.
 *
 * Double-click (tldraw's editing state) opens the full-screen reader — or, on a placeholder that
 * has no file, the file picker. Both render as portals, so the card itself stays a plain shape.
 */
function BookNodeComponentImpl({ shape, isEditing, editor }: NodeComponentProps<BookNodeProps>) {
	const { fileSrc, coverSrc, title, author, fileName } = shape.props
	const coverUrl = useAssetUrl(coverSrc)
	/*
	 * The details panel is opened by a context-menu action, which has no React tree of its own — so
	 * it names a shape in a tiny store and the matching book renders the panel. Subscribed here
	 * rather than at the extension root because this component already exists per book.
	 */
	const enriching = useSyncExternalStore(subscribeToEnrichTarget, getEnrichTarget) === shape.id

	return (
		<div className="lb-book">
			{coverUrl ? (
				<img
					className="lb-book__cover"
					src={coverUrl}
					alt={title || fileName}
					draggable={false}
				/>
			) : (
				<div className={fileSrc ? 'lb-book__jacket' : 'lb-book__jacket lb-book__jacket--empty'}>
					{fileSrc ? (
						<>
							<span className="lb-book__jacket-title">{title || fileName}</span>
							{author && <span className="lb-book__jacket-author">{author}</span>}
						</>
					) : (
						<span className="lb-book__jacket-hint">
							Drop a book file here
							<small>PDF · EPUB · MOBI · FB2 · CBZ</small>
						</span>
					)}
				</div>
			)}
			{enriching && <MetadataPicker shape={shape} editor={editor} />}
			{isEditing &&
				(fileSrc ? (
					<BookReaderOverlay
						bookId={shape.id}
						editor={editor}
						onClose={() => {
							editor.setEditingShape(null)
							editor.setSelectedShapes([shape.id])
						}}
					/>
				) : (
					<BookFilePicker shape={shape} editor={editor} />
				))}
		</div>
	)
}

/**
 * Memoized on what affects rendering, following the note's precedent: `h` is excluded (derived by
 * auto-height from the cover and `w`), and `location` is deliberately absent — the reader writes it
 * on every page turn, and re-rendering the card under the open reader for a value the card never
 * shows would be pure churn.
 *
 * `meta` is excluded too, unlike the note's: this card renders no properties (they are drawn under
 * the shape), so a property edit — reading progress on every page turn included — must not
 * re-render the cover.
 */
export const BookNodeComponent = memo(
	BookNodeComponentImpl,
	(prev, next) =>
		prev.shape.props.fileSrc === next.shape.props.fileSrc &&
		prev.shape.props.coverSrc === next.shape.props.coverSrc &&
		prev.shape.props.title === next.shape.props.title &&
		prev.shape.props.author === next.shape.props.author &&
		prev.shape.props.w === next.shape.props.w &&
		prev.isEditing === next.isEditing
)
