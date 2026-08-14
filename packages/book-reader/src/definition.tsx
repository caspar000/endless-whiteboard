import {
	createShapePropsMigrationIds,
	createShapePropsMigrationSequence,
	type NodeDefinition,
} from '@lifeboard/node-kit'
import { BookOpen } from 'lucide-react'
import { T } from 'tldraw'
import { BookNodeComponent } from './BookNodeComponent'

export const BOOK_NODE_TYPE = 'node.book'

/**
 * The property a book's reading progress is stored as — `progress` type, 0–100, so it renders as
 * the same bar every other progress property does and can be hidden, reordered and aggregated like
 * one. Deliberately *not* a shape prop: progress is data about the book, not part of its picture.
 */
export const READING_PROGRESS_PROPERTY = { name: 'Reading progress', type: 'progress' } as const

export interface BookNodeProps {
	/** `asset:<sha256>` of the book's bytes, stored *before* the shape is created. '' = placeholder. */
	fileSrc: string
	/** The original filename — format routing on open, fallback title, and what an export restores. */
	fileName: string
	/** A `BookFormat`, or ''. Typed as string because props must stay JSON scalars with `T` validators. */
	format: string
	title: string
	author: string
	/** `asset:<hash>` of the cover image (embedded cover, or the rendered first PDF page). '' = none. */
	coverSrc: string
	/** Known up front for PDFs only; 0 = unknown. */
	pageCount: number
	/**
	 * Where reading left off: a page number (PDF) or an EPUB CFI (everything foliate renders),
	 * written by the reader with `history: 'ignore'` — turning a page must never eat an undo entry.
	 */
	location: string
	/** See registry.tsx: `h` tracks the cover's rendered height until a vertical handle pins it. */
	autoHeight: boolean
}

const versions = createShapePropsMigrationIds('node.book', { RemoveProgress: 1 })

export const bookNodeDefinition: NodeDefinition<BookNodeProps> = {
	type: BOOK_NODE_TYPE,
	label: 'Book',
	icon: 'B',
	toolbarIcon: BookOpen,
	// No `kbd`: the obvious letter is `b`, but unlike `m` for notes there is no muscle-memory case
	// for spawning empty book placeholders — books arrive by dropping files, not from the keyboard.
	props: {
		fileSrc: T.string,
		fileName: T.string,
		format: T.string,
		title: T.string,
		author: T.string,
		coverSrc: T.string,
		pageCount: T.number,
		location: T.string,
		autoHeight: T.boolean,
	},
	/**
	 * Reading progress used to live in props and paint a bar inside the card. It is a *property*
	 * now (see `READING_PROGRESS_PROPERTY`), so the prop is dropped: leaving it would be a second,
	 * silently diverging copy of the same number.
	 */
	migrations: createShapePropsMigrationSequence({
		sequence: [
			{
				id: versions.RemoveProgress,
				up(props) {
					delete (props as { progress?: number }).progress
				},
			},
		],
	}),
	defaultProps: () => ({
		fileSrc: '',
		fileName: '',
		format: '',
		title: '',
		author: '',
		coverSrc: '',
		pageCount: 0,
		location: '',
		autoHeight: true,
	}),
	// A book-ish 2:3. Real proportions come from the cover image via auto-height once one exists.
	defaultSize: { w: 200, h: 300 },
	autoHeight: { minHeight: 140 },
	// The card is a cover image, so its properties belong under the shape — the same place, and the
	// same rendering, as a sticky note's. Rows drawn over the artwork read as part of the jacket.
	strips: 'below',
	component: BookNodeComponent,
	// Double-click opens the reader (or the file picker while the node is still a placeholder).
	canEdit: true,
	canScroll: true,
	getLabel: (shape) => shape.props.title || shape.props.fileName || undefined,
}
