import { NodeEditorPopover, useAssetUrl } from '@lifeboard/node-kit'
import {
	BookmarkShapeUtil,
	DOUBLE_CLICK_DURATION,
	HTMLContainer,
	isValidUrl,
	toDomPrecision,
	useValue,
	type Editor,
	type TLBookmarkAsset,
	type TLBookmarkShape,
	type TLOnBeforeCreateHandler,
	type TLOnBeforeUpdateHandler,
	type TLShapeId,
} from '@lifeboard/canvas'
import { isManagedAssetSrc } from '@lifeboard/schema'
import { useState, type CSSProperties } from 'react'
import { LinkPreviewInspector } from './LinkPreviewInspector'
import { cropPosition, hueOf, LINK_PREVIEW_SIZE, linkPreviewContent } from './linkPreview'
import { bookmarkAssetId, fillBookmark } from './linkPreviewAsset'

/**
 * A link on the board, as Freeform shows one: a square poster, the page's picture filling it, its name
 * and site on a band along the bottom. Clicking anywhere on it opens the link. The arrow in the corner
 * only says it's a link; it isn't a button. Double-click opens the inspector beside it, where the
 * name, the address and the picture (and which part of it the square shows) are changed.
 *
 * tldraw's bookmark util underneath, so its record, schema and migrations are untouched (the server
 * builds the same schema, `boardSchema.test.ts`), and every link card already on a board, Freeform's
 * included, gets the new look. It replaces the default by type, as the frame does (`boardShapeUtils.ts`).
 */
export class LinkPreviewShapeUtil extends BookmarkShapeUtil {
	override canEdit = () => true
	override isAspectRatioLocked = () => true

	override getDefaultProps(): TLBookmarkShape['props'] {
		return { url: '', w: LINK_PREVIEW_SIZE, h: LINK_PREVIEW_SIZE, assetId: null }
	}

	// The hover band shows the whole address, so the GPU's copy is read again when it changes.
	override getRenderKey(shape: TLBookmarkShape): string {
		return this.editor.getHoveredShapeId() === shape.id ? 'hover' : ''
	}

	override getText(shape: TLBookmarkShape) {
		return linkPreviewContent(shape, bookmarkAsset(this.editor, shape)).title
	}

	override component(shape: TLBookmarkShape) {
		return <LinkPreviewCard editor={this.editor} shape={shape} />
	}

	override indicator(shape: TLBookmarkShape) {
		return <rect className="lb-linkcard__indicator" width={toDomPrecision(shape.props.w)} height={toDomPrecision(shape.props.h)} />
	}

	/**
	 * A click opens the link — after a double-click's worth of waiting, because a second click makes it
	 * a double-click, which edits instead. Shift or ⌘ selects, as on any shape; so does a drag
	 * (`PointingShape.selectBeforeDragging`). Returning the shape unchanged is what tells the select
	 * tool the click was taken, so it doesn't select the card as well.
	 */
	override onClick = (shape: TLBookmarkShape) => {
		// `ctrlKey` is ⌘ on a Mac, as tldraw reads it.
		const { shiftKey, ctrlKey, altKey } = this.editor.inputs
		if (shiftKey || ctrlKey || altKey) return
		if (pendingOpen?.id === shape.id) {
			clearTimeout(pendingOpen.timer)
			pendingOpen = null
			this.editor.select(shape.id)
			this.editor.setEditingShape(shape.id)
			this.editor.setCurrentTool('select.editing_shape')
			return { id: shape.id, type: shape.type }
		}
		if (pendingOpen) clearTimeout(pendingOpen.timer)
		const editor = this.editor
		pendingOpen = {
			id: shape.id,
			timer: setTimeout(() => {
				pendingOpen = null
				if (editor.getEditingShapeId() === shape.id) return
				openLink(editor.getShape<TLBookmarkShape>(shape.id)?.props.url ?? '')
			}, DOUBLE_CLICK_DURATION),
		}
		return { id: shape.id, type: shape.type }
	}

	/**
	 * A new card without details gets them; one pasted or synced with its asset already has them. Not
	 * the base util's, which looked them up through a single shared debounce, so of two links dropped
	 * together only the second was ever named.
	 */
	override onBeforeCreate: TLOnBeforeCreateHandler<TLBookmarkShape> = (shape) => {
		if (shape.props.assetId || !isValidUrl(shape.props.url)) return
		const editor = this.editor
		const known = editor.getAsset(bookmarkAssetId(shape.props.url))
		if (known) return { ...shape, props: { ...shape.props, assetId: known.id } }
		// After the create, which this runs inside of.
		queueMicrotask(() => void fillBookmark(editor, shape.id))
	}

	/** A new address: the details of that address instead, the card's own changes kept. */
	override onBeforeUpdate: TLOnBeforeUpdateHandler<TLBookmarkShape> = (prev, next) => {
		if (prev.props.url === next.props.url) return
		if (!isValidUrl(next.props.url)) return { ...next, props: { ...next.props, url: prev.props.url } }
		const editor = this.editor
		const known = editor.getAsset(bookmarkAssetId(next.props.url))
		if (!known) queueMicrotask(() => void fillBookmark(editor, next.id))
		return { ...next, props: { ...next.props, assetId: known ? known.id : null } }
	}
}

/** The click waiting to see whether it's the first of two. */
let pendingOpen: { id: TLShapeId; timer: ReturnType<typeof setTimeout> } | null = null

function openLink(url: string) {
	if (!isValidUrl(url)) return
	window.open(url, '_blank', 'noopener,noreferrer')
}

function bookmarkAsset(editor: Editor, shape: TLBookmarkShape): TLBookmarkAsset | null {
	const asset = shape.props.assetId ? editor.getAsset(shape.props.assetId) : null
	return asset?.type === 'bookmark' ? (asset as TLBookmarkAsset) : null
}

/** A picture the card can show: a file of the board's, resolved, or an address on the web as it is. */
export function useCardImage(src: string): string | null {
	const managed = isManagedAssetSrc(src)
	const kept = useAssetUrl(managed ? src : '')
	if (!src) return null
	return managed ? kept : src
}

function LinkPreviewCard({ editor, shape }: { editor: Editor; shape: TLBookmarkShape }) {
	const asset = useValue('link card asset', () => bookmarkAsset(editor, shape), [editor, shape])
	const isHovered = useValue('link card hovered', () => editor.getHoveredShapeId() === shape.id, [editor, shape.id])
	const isEditing = useValue('link card editing', () => editor.getEditingShapeId() === shape.id, [editor, shape.id])
	const content = linkPreviewContent(shape, asset)
	const image = useCardImage(content.image)
	const favicon = useCardImage(content.favicon)
	const [natural, setNatural] = useState<{ src: string; w: number; h: number } | null>(null)
	const size = natural?.src === image ? natural : null
	const letter = (content.domain || content.title).charAt(0).toUpperCase()

	return (
		<HTMLContainer>
			<div
				className={`lb-linkcard${isHovered ? ' is-hover' : ''}`}
				style={{ '--lb-linkcard-hue': hueOf(content.domain) } as CSSProperties}
			>
				{image ? (
					<img
						className="lb-linkcard__image"
						src={image}
						alt=""
						draggable={false}
						style={{ objectPosition: size ? cropPosition(content.focus, size.w, size.h) : undefined }}
						onLoad={(e) => setNatural({ src: image, w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
					/>
				) : (
					<div className="lb-linkcard__fallback">
						<span className="lb-linkcard__tile">
							{favicon ? <img src={favicon} alt="" draggable={false} /> : letter}
						</span>
					</div>
				)}
				<span className="lb-linkcard__badge" aria-hidden="true">
					<span className="lb-linkcard__badge-dot" />↗
				</span>
				<div className="lb-linkcard__band">
					<div className="lb-linkcard__band-inner">
						<p className="lb-linkcard__title">{content.title}</p>
						<p className="lb-linkcard__domain">
							<span className="lb-linkcard__fav">{favicon ? <img src={favicon} alt="" draggable={false} /> : letter}</span>
							<span className="lb-linkcard__domain-text">{content.domain}</span>
						</p>
						<p className="lb-linkcard__url">{content.address}</p>
					</div>
				</div>
			</div>
			{isEditing && (
				<NodeEditorPopover shape={shape} editor={editor} width={300} side="right">
					<LinkPreviewInspector editor={editor} shape={shape} content={content} image={image} imageSize={size} />
				</NodeEditorPopover>
			)}
		</HTMLContainer>
	)
}
