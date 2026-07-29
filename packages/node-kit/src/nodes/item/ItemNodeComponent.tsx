import { memo, useEffect, useRef } from 'react'
import { stopEventPropagation, useImageOrVideoAsset, type TLAssetId } from 'tldraw'
import { fieldKeyLabel, formatFieldValue } from '../../fields'
import { updateNodeProps, type NodeComponentProps } from '../../registry'
import type { ItemNodeProps } from './definition'
import { ItemFieldEditor } from './ItemFieldEditor'
import { NodeEditorPopover } from '../../NodeEditorPopover'

function ItemImage({ assetId, width, alt }: { assetId: TLAssetId; width: number; alt: string }) {
	// tldraw's own resolution hook: honours the custom TLAssetStore, skips work while the shape is
	// off-screen, and picks a resolution appropriate to the current zoom.
	const { url } = useImageOrVideoAsset({ assetId, width })
	if (!url) return <div className="lb-item__image lb-item__image--loading" />
	return <img className="lb-item__image" src={url} alt={alt} draggable={false} />
}

/**
 * Mounted only while the item is being edited, so its lifetime is the editing session and the title
 * commit falls out of cleanup — one `updateShape`, one undo entry (§7). Uncontrolled input with the
 * value mirrored into a ref: no state means typing triggers no render, and no update loop is
 * possible. (Holding the draft in state and syncing it from props with effects is what caused a
 * "Maximum update depth exceeded" crash in the markdown node; same shape of bug, same fix.)
 */
function ItemTitleEditor({
	initial,
	onCommit,
	onExit,
}: {
	initial: string
	onCommit: (next: string) => void
	onExit: () => void
}) {
	const inputRef = useRef<HTMLInputElement>(null)
	const valueRef = useRef(initial)
	const commitRef = useRef(onCommit)
	commitRef.current = onCommit

	useEffect(() => {
		// Next frame: tldraw takes focus back to its canvas while entering the editing state.
		const frame = requestAnimationFrame(() => inputRef.current?.select())
		return () => {
			cancelAnimationFrame(frame)
			commitRef.current(valueRef.current)
		}
	}, [])

	return (
		<input
			ref={inputRef}
			className="lb-item__title lb-item__title--editing"
			defaultValue={initial}
			placeholder="Item name"
			aria-label="Item name"
			onChange={(e) => {
				valueRef.current = e.currentTarget.value
			}}
			onKeyDown={(e) => {
				if (e.key === 'Escape' || e.key === 'Enter') {
					onExit()
					return
				}
				e.stopPropagation()
			}}
		/>
	)
}

function ItemNodeComponentImpl({ shape, isEditing, editor }: NodeComponentProps<ItemNodeProps>) {
	const { title, imageAssetId, tags, fields, w } = shape.props

	const exitEditing = () => {
		editor.setEditingShape(null)
		editor.setSelectedShapes([shape.id])
	}

	const body = (
		<>
			{imageAssetId ? (
				<ItemImage assetId={imageAssetId as TLAssetId} width={w} alt={title} />
			) : (
				<div className="lb-item__image lb-item__image--empty" aria-hidden="true">
					<span>＋</span>
				</div>
			)}

			<div className="lb-item__text">
				{isEditing ? (
					<ItemTitleEditor
						initial={title}
						onCommit={(next) => {
							if (next !== shape.props.title) updateNodeProps(editor, shape, { title: next })
						}}
						onExit={exitEditing}
					/>
				) : (
					<div className={`lb-item__title${title ? '' : ' lb-item__title--empty'}`}>
						{title || 'Untitled'}
					</div>
				)}

				{fields.length > 0 && (
					<dl className="lb-item__fields">
						{fields.map((field, i) => (
							<div className="lb-item__field" key={`${field.key}-${i}`}>
								<dt>{fieldKeyLabel(field.key)}</dt>
								<dd
									className={
										field.type === 'currency'
											? 'lb-item__value lb-item__value--money'
											: 'lb-item__value'
									}
								>
									{formatFieldValue(field)}
								</dd>
							</div>
						))}
					</dl>
				)}

				{tags.length > 0 && (
					<ul className="lb-item__tags">
						{tags.map((tag) => (
							<li key={tag}>{tag}</li>
						))}
					</ul>
				)}
			</div>
		</>
	)

	if (!isEditing) return <div className="lb-item">{body}</div>

	return (
		<div
			className="lb-item lb-item--editing"
			onPointerDown={stopEventPropagation}
			onTouchStart={stopEventPropagation}
			onWheel={stopEventPropagation}
			style={{ pointerEvents: 'all' }}
		>
			{body}
			<NodeEditorPopover shape={shape} editor={editor} width={340}>
				<ItemFieldEditor shape={shape} editor={editor} />
			</NodeEditorPopover>
		</div>
	)
}

export const ItemNodeComponent = memo(
	ItemNodeComponentImpl,
	(prev, next) =>
		prev.isEditing === next.isEditing &&
		prev.shape.props === next.shape.props &&
		prev.shape.parentId === next.shape.parentId
)
