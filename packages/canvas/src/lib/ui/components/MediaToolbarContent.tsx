import {
	TLImageShape,
	TLShapeId,
	TLVideoShape,
	useEditor,
	useValue,
} from '@lifeboard/canvas-editor'
import { cropImageToAspect } from '../../utils/crop/cropToAspect'
import { useCallback } from 'react'
import { TldrawUiToolbarButton } from './ContextualToolbar'
import { Icon } from './primitives/Icon'

/** Asks for a file of the given kind and calls back with it. */
function pickFile(accept: string, onFile: (file: File) => void) {
	const input = document.createElement('input')
	input.type = 'file'
	input.accept = accept
	input.onchange = () => {
		const file = input.files?.[0]
		if (file) onFile(file)
	}
	input.click()
}

/** Replacing and downloading the file behind an image or video shape. */
function useMediaFile(shapeId: TLShapeId) {
	const editor = useEditor()

	const replace = useCallback(
		(accept: string) =>
			pickFile(accept, async (file) => {
				const shape = editor.getShape<TLImageShape | TLVideoShape>(shapeId)
				if (!shape) return
				const asset = await editor.getAssetForExternalContent({ type: 'file', file })
				if (!asset || (asset.type !== 'image' && asset.type !== 'video')) return
				// Same width; the height follows the new file's proportions.
				const h = asset.props.w ? (shape.props.w * asset.props.h) / asset.props.w : shape.props.h
				editor.mark('replace media')
				editor.createAssets([asset])
				editor.updateShapes([{ id: shapeId, type: shape.type, props: { assetId: asset.id, h } }])
			}),
		[editor, shapeId]
	)

	const download = useCallback(async () => {
		const shape = editor.getShape<TLImageShape | TLVideoShape>(shapeId)
		const asset = shape?.props.assetId ? editor.getAsset(shape.props.assetId) : undefined
		if (!shape || !asset) return
		const url = await editor.resolveAssetUrl(asset.id, { shouldResolveToOriginal: true })
		if (!url) return
		const blob = await (await fetch(url)).blob()
		const link = document.createElement('a')
		link.href = URL.createObjectURL(blob)
		link.download = 'name' in asset.props && asset.props.name ? asset.props.name : 'file'
		link.click()
		URL.revokeObjectURL(link.href)
	}, [editor, shapeId])

	return { replace, download }
}

const CROP_ASPECTS: { label: string; aspect: number | 'original' }[] = [
	{ label: 'Original', aspect: 'original' },
	{ label: '1:1', aspect: 1 },
	{ label: '4:3', aspect: 4 / 3 },
	{ label: '16:9', aspect: 16 / 9 },
]

/**
 * The buttons for a selected image: replace it, crop it, download it, and edit its alt text. While
 * cropping (`isManipulating`): the shapes to crop to, and one button to finish.
 *
 * @public
 */
export function DefaultImageToolbarContent({
	imageShapeId,
	isManipulating,
	onEditAltTextStart,
	onManipulatingStart,
	onManipulatingEnd,
}: {
	imageShapeId: TLImageShape['id']
	isManipulating: boolean
	onEditAltTextStart(): void
	onManipulatingStart(): void
	onManipulatingEnd(): void
}) {
	const editor = useEditor()
	const { replace, download } = useMediaFile(imageShapeId)
	const isLocked = useValue('locked', () => editor.getShape(imageShapeId)?.isLocked ?? true, [
		editor,
		imageShapeId,
	])

	if (isManipulating) {
		return (
			<>
				{/* The shape to crop to (B5): the picture's own, square, or a common photo or screen. */}
				{CROP_ASPECTS.map(({ label, aspect }) => (
					<TldrawUiToolbarButton
						key={label}
						type="normal"
						title={aspect === 'original' ? 'The whole picture' : `Crop to ${label}`}
						onClick={() => cropImageToAspect(editor, imageShapeId, aspect)}
					>
						{label}
					</TldrawUiToolbarButton>
				))}
				<TldrawUiToolbarButton type="normal" title="Done" onClick={onManipulatingEnd}>
					Done
				</TldrawUiToolbarButton>
			</>
		)
	}

	return (
		<>
			<TldrawUiToolbarButton
				type="icon"
				title="Replace image"
				disabled={isLocked}
				onClick={() => replace('image/*')}
			>
				<Icon icon="image" small />
			</TldrawUiToolbarButton>
			{/* The 2023 icon set has no crop or download icon; these two are words. */}
			<TldrawUiToolbarButton
				type="normal"
				title="Crop"
				disabled={isLocked}
				onClick={() => {
					editor.setCroppingShape(imageShapeId)
					onManipulatingStart()
				}}
			>
				Crop
			</TldrawUiToolbarButton>
			<TldrawUiToolbarButton type="normal" title="Download" onClick={() => void download()}>
				Download
			</TldrawUiToolbarButton>
			<TldrawUiToolbarButton type="normal" title="Alternative text" onClick={onEditAltTextStart}>
				Alt
			</TldrawUiToolbarButton>
		</>
	)
}

/**
 * The buttons for a selected video: replace it, download it, and edit its alt text.
 *
 * @public
 */
export function DefaultVideoToolbarContent({
	videoShapeId,
	onEditAltTextStart,
}: {
	videoShapeId: TLVideoShape['id']
	onEditAltTextStart(): void
}) {
	const { replace, download } = useMediaFile(videoShapeId)
	return (
		<>
			<TldrawUiToolbarButton type="icon" title="Replace video" onClick={() => replace('video/*')}>
				<Icon icon="image" small />
			</TldrawUiToolbarButton>
			<TldrawUiToolbarButton type="normal" title="Download" onClick={() => void download()}>
				Download
			</TldrawUiToolbarButton>
			<TldrawUiToolbarButton type="normal" title="Alternative text" onClick={onEditAltTextStart}>
				Alt
			</TldrawUiToolbarButton>
		</>
	)
}
