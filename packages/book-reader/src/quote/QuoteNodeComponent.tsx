import { NodeStrips, useAssetUrl, type NodeComponentProps } from '@lifeboard/node-kit'
import { memo } from 'react'
import { useValue, type TLShapeId } from 'tldraw'
import type { BookNodeProps } from '../definition'
import { BookReaderOverlay } from '../reader/BookReaderOverlay'
import type { QuoteNodeProps } from './definition'

/**
 * An excerpt from a book, as a card on the board: the passage (or a clipped page), and a footer
 * saying which book and where. Double-click reopens that book at exactly this spot.
 *
 * The arrow drawn to the book when the quote is created is what the *board* reasons about — it is
 * an edge like any other, so tables and rollups see "this note came from that book" with no special
 * case. This card holds the other half: the precise location, which an arrow cannot carry.
 */
function QuoteNodeComponentImpl({ shape, isEditing, editor }: NodeComponentProps<QuoteNodeProps>) {
	const { text, imageSrc, sourceId, location, locationLabel } = shape.props
	const clipUrl = useAssetUrl(imageSrc)

	/**
	 * The source book, read live: renaming a book (or losing it) is reflected on every quote taken
	 * from it, because nothing about the book is copied into the quote except its id.
	 */
	const source = useValue(
		'lifeboard:quote-source',
		() => {
			if (!sourceId) return null
			const found = editor.getShape(sourceId as TLShapeId)
			if (!found || found.type !== 'node.book') return null
			const props = found.props as BookNodeProps
			return { id: found.id, title: props.title || props.fileName }
		},
		[editor, sourceId]
	)

	return (
		<div className="lb-quote">
			{clipUrl ? (
				<img className="lb-quote__clip" src={clipUrl} alt={locationLabel || 'Page clip'} draggable={false} />
			) : (
				<blockquote className="lb-quote__text">{text}</blockquote>
			)}
			<footer className="lb-quote__source">
				{source ? (
					<>
						<span className="lb-quote__book">{source.title}</span>
						{locationLabel && <span className="lb-quote__loc">{locationLabel}</span>}
					</>
				) : (
					// The book is gone (deleted, or this quote was pasted onto another board). The
					// excerpt is still worth keeping, so the card degrades to plain prose.
					<span className="lb-quote__book lb-quote__book--missing">Source book not on this board</span>
				)}
			</footer>
			<NodeStrips shape={shape} editor={editor} />
			{isEditing && source && (
				<BookReaderOverlay
					bookId={source.id}
					editor={editor}
					startAt={location}
					/*
					 * Jumping to a quote must not move your bookmark: you came to re-read one passage,
					 * not to resume from it. The book's own reader is the only thing that writes
					 * position and progress.
					 */
					saveProgress={false}
					onClose={() => {
						editor.setEditingShape(null)
						editor.setSelectedShapes([shape.id])
					}}
				/>
			)}
		</div>
	)
}

export const QuoteNodeComponent = memo(
	QuoteNodeComponentImpl,
	(prev, next) =>
		prev.shape.props.text === next.shape.props.text &&
		prev.shape.props.imageSrc === next.shape.props.imageSrc &&
		prev.shape.props.locationLabel === next.shape.props.locationLabel &&
		prev.shape.props.sourceId === next.shape.props.sourceId &&
		prev.shape.props.w === next.shape.props.w &&
		prev.shape.meta === next.shape.meta &&
		prev.isEditing === next.isEditing
)
