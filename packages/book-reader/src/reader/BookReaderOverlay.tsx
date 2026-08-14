import {
	createProperty,
	findProperty,
	getAssetBridge,
	optionHue,
	propertyIdFromName,
	syncPropertyOptions,
	readPropertyRegistry,
	readShapeProperties,
	updateShapeProperties,
} from '@lifeboard/node-kit'
import {
	BookText,
	Columns2,
	Crop,
	QuoteIcon,
	Scissors,
	ScrollText,
	Settings2,
	Square,
	X,
} from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
	stopEventPropagation,
	useValue,
	type Editor,
	type TLShapeId,
	type TLShapePartial,
} from 'tldraw'
import { READING_PROGRESS_PROPERTY, type BookNodeProps } from '../definition'
import { addQuoteToBoard, type NewQuote } from '../quote/createQuote'
import { highlightProperty, QUOTE_NODE_TYPE, type QuoteNodeProps } from '../quote/definition'
import { typingElsewhere } from './keys'
import { SettingsModal, type SettingsGroup } from './SettingsModal'
import { SettingsPanel } from './SettingsPanel'
import {
	engineFor,
	loadReaderSettings,
	saveReaderSettings,
	type ReaderSettings,
} from './settings'
import { TocPanel } from './TocPanel'
import {
	VIEW_MODE_LABELS,
	VIEW_MODES,
	type Highlight,
	type ReaderApi,
	type ReaderSelection,
	type ViewMode,
} from './types'

// Both renderers are heavyweight (pdf.js; foliate + its vendored zip) and load only on first open.
const PdfReader = lazy(() => import('./PdfReader').then((m) => ({ default: m.PdfReader })))
const FoliateReader = lazy(() => import('./FoliateReader').then((m) => ({ default: m.FoliateReader })))

const VIEW_MODE_ICONS: Record<ViewMode, typeof Square> = {
	page: Square,
	spread: Columns2,
	scroll: ScrollText,
}

export type { ReaderSelection } from './types'

/** The parts of a selection a quote keeps. */
function quoteFrom(selection: ReaderSelection): NewQuote {
	return {
		text: selection.text,
		location: selection.location,
		locationLabel: selection.locationLabel,
		rects: selection.rects,
	}
}

/**
 * The full-screen reader, shown while a shape is in tldraw's editing state.
 *
 * Two callers, which is why it takes a book *id* rather than a shape: the book node opens it to
 * read (saving position as you go), and a quote node opens it at the passage the quote came from
 * (`startAt`, and emphatically not saving — see `saveProgress`).
 *
 * Everything engine-specific lives below it: this owns the chrome (title, view mode, outline, clip
 * mode, the quote button) and talks to whichever reader is mounted through a small `ReaderApi`.
 *
 * Portalled into the editor's container (the `NodeEditorPopover` precedent, taken full-bleed):
 * inside a shape it would be camera-scaled and stacked under later shapes; outside the canvas
 * transform it reads at natural size.
 */
export function BookReaderOverlay({
	bookId,
	editor,
	startAt,
	saveProgress = true,
	onClose,
}: {
	bookId: TLShapeId
	editor: Editor
	/** Open here instead of where reading left off — a quote's location. */
	startAt?: string
	/** Whether to record position and progress. False when jumping in from a quote. */
	saveProgress?: boolean
	onClose(): void
}) {
	/**
	 * The book's identity, read live so a rename shows in the title bar. `location` is deliberately
	 * *not* in here: the reader writes it on every page turn, and re-rendering the overlay on each
	 * one would tear through the renderer below for a value only its first mount uses.
	 */
	const book = useValue(
		'lifeboard:reader-book',
		() => {
			const shape = editor.getShape(bookId)
			if (!shape || shape.type !== 'node.book') return null
			const props = shape.props as BookNodeProps
			return {
				fileSrc: props.fileSrc,
				fileName: props.fileName,
				format: props.format,
				title: props.title,
			}
		},
		[editor, bookId]
	)

	// Read once, at mount, for the reason above.
	const [initialLocation] = useState(() => {
		if (startAt) return startAt
		const shape = editor.getShape(bookId)
		return shape && shape.type === 'node.book' ? (shape.props as BookNodeProps).location : ''
	})

	/**
	 * The quotes taken from this book, as marks. Live, so a passage you highlight appears in the
	 * page immediately — and one you delete from the board stops being marked.
	 *
	 * The tag's hue is resolved here rather than in the readers: the property registry is a
	 * board-level concern, and the readers should know only "what colour".
	 */
	const highlights = useValue<readonly Highlight[]>(
		'lifeboard:book-highlights',
		() => {
			const tagId = findProperty(readPropertyRegistry(editor), propertyIdFromName('Highlight'))?.id
			const found: Highlight[] = []
			for (const shape of editor.getCurrentPageShapes()) {
				if (shape.type !== QUOTE_NODE_TYPE) continue
				const props = shape.props as QuoteNodeProps
				if (props.sourceId !== bookId || !props.location) continue
				const tag = tagId ? readShapeProperties(shape)[tagId] : null
				found.push({
					quoteId: shape.id,
					location: props.location,
					rects: props.rects,
					hue:
						typeof tag === 'string' && tag
							? optionHue(tag, Object.fromEntries(tagsRef.current.map((t) => [t.label, t.hue])))
							: null,
				})
			}
			return found
		},
		[editor, bookId]
	)

	const [file, setFile] = useState<File | null>(null)
	const [missing, setMissing] = useState(false)
	const [selection, setSelection] = useState<ReaderSelection | null>(null)
	const [added, setAdded] = useState(0)
	/** Every reading preference, in one place, remembered for the next book (see `settings.ts`). */
	const [settings, setSettings] = useState<ReaderSettings>(loadReaderSettings)
	const [clipping, setClipping] = useState(false)
	const [tocOpen, setTocOpen] = useState(false)
	const [settingsOpen, setSettingsOpen] = useState(false)
	/** Which page of the settings proper is open, or null when the sidebar is enough. */
	const [customizing, setCustomizing] = useState<SettingsGroup | null>(null)
	const [api, setApi] = useState<ReaderApi>({ toc: [], goTo: () => {} })

	const fileSrc = book?.fileSrc ?? ''
	const fileName = book?.fileName ?? ''

	useEffect(() => {
		if (!fileSrc) return
		let cancelled = false
		void getAssetBridge()
			.getBlob(fileSrc)
			.then((blob) => {
				if (cancelled) return
				if (!blob) {
					setMissing(true)
					return
				}
				// Re-wrapped as a File: foliate sniffs `name` to tell CBZ/FBZ from EPUB inside a zip.
				setFile(new File([blob], fileName, blob.type ? { type: blob.type } : undefined))
			})
		return () => {
			cancelled = true
		}
	}, [fileSrc, fileName])

	/** Every change to a preference is saved as it is made — there is no "apply" here. */
	// Read by callbacks that must not be rebuilt every time a setting moves.
	const settingsRef = useRef(settings)
	settingsRef.current = settings
	/** Read inside `useValue`, which recomputes outside React's render and cannot close over state. */
	const tagsRef = useRef(settings.tags)
	tagsRef.current = settings.tags

	const change = useCallback((patch: Partial<ReaderSettings>) => {
		setSettings((current) => {
			const next = { ...current, ...patch }
			saveReaderSettings(next)
			return next
		})
	}, [])
	const viewMode = settings.viewMode

	/*
	 * The tags, pushed into the property that draws them.
	 *
	 * `createProperty` leaves a property it already finds alone, on purpose — it runs on every write
	 * and must not undo a rename made in the properties panel. A list configured over here has to
	 * push instead, which is what `syncPropertyOptions` is for: options and colours, nothing else.
	 */
	useEffect(() => {
		const id = propertyIdFromName('Highlight')
		if (!findProperty(readPropertyRegistry(editor), id)) return
		const def = highlightProperty(settings.tags)
		editor.run(() => syncPropertyOptions(editor, id, def.options, def.optionHues), {
			history: 'ignore',
		})
	}, [editor, settings.tags])

	/**
	 * Reading position, written on every relocation with `history: 'ignore'`: page turns are not
	 * edits, and an undo after a reading session must undo the last *edit*, not re-turn pages.
	 *
	 * Two destinations, because they are two different things. The exact position (a page number or
	 * an EPUB CFI) is internal resume state and lives in props. How far through you are is *data
	 * about the book* — so it goes into the property system as an ordinary `progress` property,
	 * rendering as the same bar any other progress property does, hideable and reorderable like one,
	 * and countable by tables and expressions.
	 */
	const save = useCallback(
		(nextLocation: string, fraction: number) => {
			if (!saveProgress) return
			const current = editor.getShape(bookId)
			if (!current || current.type !== 'node.book') return
			const percent = Math.min(100, Math.max(0, Math.round(fraction * 100)))
			const props = current.props as BookNodeProps

			editor.run(
				() => {
					if (props.location !== nextLocation) {
						editor.updateShape({
							id: bookId,
							type: current.type,
							props: { location: nextLocation },
						} as unknown as TLShapePartial)
					}

					// Created on first read rather than at import: a book you have never opened should
					// not claim 0% — it should carry no progress at all. Idempotent by id thereafter.
					const def = createProperty(editor, READING_PROGRESS_PROPERTY)
					if (!def) return
					// Re-read: the write above replaced the record this closure captured.
					const shapeNow = editor.getShape(bookId)
					if (!shapeNow) return
					if (readShapeProperties(shapeNow)[def.id] === percent) return
					updateShapeProperties(editor, shapeNow, { [def.id]: percent })
				},
				{ history: 'ignore' }
			)
		},
		[editor, bookId, saveProgress]
	)

	/**
	 * Collect an excerpt without leaving the book. The reader stays open on purpose — a reading
	 * session produces a run of quotes, and bouncing back to the canvas after each one would make
	 * gathering three of them a chore.
	 */
	const addQuote = useCallback(
		(quote: NewQuote) => {
			void addQuoteToBoard(
				editor,
				bookId,
				quote,
				settingsRef.current.quoteArrow,
				settingsRef.current.tags
			).then((id) => {
				if (!id) return
				setSelection(null)
				setAdded((n) => n + 1)
			})
		},
		[editor, bookId]
	)

	/**
	 * Clicking a mark takes you to the card it produced — the other direction of the same link that
	 * double-clicking a quote uses. The reader closes, because the answer to "what did I write about
	 * this?" is on the board, not in the book.
	 */
	const showQuote = useCallback(
		(quoteId: string) => {
			onClose()
			const id = quoteId as TLShapeId
			if (!editor.getShape(id)) return
			editor.select(id)
			const bounds = editor.getShapePageBounds(id)
			if (bounds) editor.zoomToBounds(bounds.clone().expandBy(160), { targetZoom: 1, animation: { duration: 200 } })
		},
		[editor, onClose]
	)

	// Capture-phase so the close claims Escape before tldraw's container handler interprets it
	// (see docs/tldraw-api-notes.md on `markEventAsHandled` — the note editor learned this the
	// hard way). Window-level because focus may sit inside the reader's iframe chrome.
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return
			// Not ours if something over the reader has the caret — the command palette, say.
			if (typingElsewhere(editor.getContainer())) return
			editor.markEventAsHandled(event)
			// Escape backs out one layer at a time, rather than always closing the book.
			if (customizing) setCustomizing(null)
			else if (clipping) setClipping(false)
			else if (settingsOpen) setSettingsOpen(false)
			else if (tocOpen) setTocOpen(false)
			else onClose()
		}
		window.addEventListener('keydown', onKeyDown, { capture: true })
		return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
	}, [editor, onClose, clipping, tocOpen, settingsOpen, customizing])

	// A quote landing on the board is invisible from in here, so say so briefly.
	useEffect(() => {
		if (!added) return
		const timer = setTimeout(() => setAdded(0), 1600)
		return () => clearTimeout(timer)
	}, [added])

	const isFixedLayout = book?.format === 'pdf'
	const engine = book ? engineFor(book.format) : null
	const readerProps = useMemo(
		() => ({
			viewMode,
			settings,
			highlights,
			onRelocate: save,
			onSelect: setSelection,
			onReady: setApi,
			onHighlightClick: showQuote,
		}),
		[viewMode, settings, highlights, save, showQuote]
	)

	if (!book) return null

	return createPortal(
		<div
			className="lb-reader"
			style={{ ['--lb-mark-a' as string]: `${settings.markOpacity}%` }}
			onPointerDown={stopEventPropagation}
			onTouchStart={stopEventPropagation}
			onWheel={stopEventPropagation}
		>
			<header className="lb-reader__bar">
				<button
					type="button"
					className={tocOpen ? 'lb-reader__tool lb-reader__tool--on' : 'lb-reader__tool'}
					onClick={() => setTocOpen((open) => !open)}
					aria-pressed={tocOpen}
					title="Contents"
				>
					<BookText size={15} aria-hidden />
				</button>
				<span className="lb-reader__title">{book.title || book.fileName}</span>

				<div className="lb-reader__modes" role="group" aria-label="View">
					{VIEW_MODES.map((mode) => {
						const Icon = VIEW_MODE_ICONS[mode]
						return (
							<button
								key={mode}
								type="button"
								className={
									viewMode === mode ? 'lb-reader__tool lb-reader__tool--on' : 'lb-reader__tool'
								}
								onClick={() => change({ viewMode: mode })}
								aria-pressed={viewMode === mode}
								title={VIEW_MODE_LABELS[mode]}
							>
								<Icon size={15} aria-hidden />
							</button>
						)
					})}
				</div>

				{isFixedLayout && (
					<>
						<button
							type="button"
							className={clipping ? 'lb-reader__tool lb-reader__tool--on' : 'lb-reader__tool'}
							onClick={() => setClipping((on) => !on)}
							aria-pressed={clipping}
							title="Clip an area to the board"
						>
							<Crop size={15} aria-hidden />
						</button>
						<button
							type="button"
							className="lb-reader__tool"
							onClick={() => api.clipPage?.()}
							title="Clip the whole page to the board"
						>
							<Scissors size={15} aria-hidden />
						</button>
					</>
				)}

				{engine && (
					<button
						type="button"
						className={settingsOpen ? 'lb-reader__tool lb-reader__tool--on' : 'lb-reader__tool'}
						onClick={() => setSettingsOpen((open) => !open)}
						aria-pressed={settingsOpen}
						title="Reading settings"
					>
						<Settings2 size={15} aria-hidden />
					</button>
				)}

				{added > 0 && (
					<span className="lb-reader__added" role="status">
						{added === 1 ? 'Quote added' : `${added} quotes added`}
					</span>
				)}
				<button type="button" className="lb-reader__close" onClick={onClose} aria-label="Close reader">
					<X size={16} aria-hidden />
				</button>
			</header>

			{clipping && (
				<p className="lb-reader__hint" role="status">
					Drag over the page to clip a region to the board
				</p>
			)}

			<div className="lb-reader__body">
				{tocOpen && (
					<TocPanel items={api.toc} onNavigate={api.goTo} onClose={() => setTocOpen(false)} />
				)}
				{settingsOpen && engine && (
					<SettingsPanel
						settings={settings}
						onChange={change}
						onCustomize={setCustomizing}
						onClose={() => setSettingsOpen(false)}
					/>
				)}
				{missing ? (
					<p className="lb-reader__notice">
						This book’s file is missing from local storage — it may have been cleaned up on
						another device. Re-import the file to read it.
					</p>
				) : !file ? (
					<p className="lb-reader__notice">Opening…</p>
				) : (
					<Suspense fallback={<p className="lb-reader__notice">Opening…</p>}>
						{isFixedLayout ? (
							<PdfReader
								file={file}
								initialLocation={initialLocation}
								clipping={clipping}
								onQuote={addQuote}
								onClipDone={() => setClipping(false)}
								{...readerProps}
							/>
						) : (
							<FoliateReader file={file} initialLocation={initialLocation} {...readerProps} />
						)}
					</Suspense>
				)}
			</div>

			{customizing && engine && (
				<SettingsModal
					settings={settings}
					engine={engine}
					viewMode={viewMode}
					group={customizing}
					container={editor.getContainer()}
					onChange={change}
					onClose={() => setCustomizing(null)}
				/>
			)}

			{selection && (
				/*
				 * `position: fixed` and client coordinates, so the button needs no knowledge of where
				 * the editor's container sits — which matters because one of the two readers puts its
				 * selection inside an iframe, and the other in our own DOM.
				 */
				<div
					className="lb-reader__quote-bar"
					style={{ left: selection.rect.left + selection.rect.width / 2, top: selection.rect.top - 46 }}
				>
					<button
						type="button"
						className="lb-reader__quote-btn"
						onClick={() =>
							// The plain button carries whatever the default tag is set to; the swatches
							// beside it name their own and always win.
							addQuote({ ...quoteFrom(selection), tag: settings.quoteTag || undefined })
						}
					>
						<QuoteIcon size={13} aria-hidden />
						Add quote
					</button>
					{/*
					 * Why it matters, chosen as you take it. The swatches are the tag's own colour, so
					 * the mark left in the book, the chip on the card and this button all agree — and
					 * naming the reason rather than the colour is what makes that possible (see
					 * the tag list in the settings).
					 */}
					<span className="lb-reader__tags">
						{settings.tags.map(({ label: tag, hue }) => (
							<button
								key={tag}
								type="button"
								className="lb-reader__tag"
								title={`Add quote — ${tag}`}
								aria-label={`Add quote tagged ${tag}`}
								style={{ ['--lb-opt-h' as string]: String(hue) }}
								onClick={() => addQuote({ ...quoteFrom(selection), tag })}
							/>
						))}
					</span>
				</div>
			)}
		</div>,
		editor.getContainer()
	)
}
