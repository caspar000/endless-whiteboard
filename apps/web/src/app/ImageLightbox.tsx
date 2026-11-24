import { useEffect } from 'react'
import { createPortal } from 'react-dom'

/**
 * A picture, full size, over everything. Closed by clicking anywhere or pressing Escape. Drawn on the
 * body, so a scaled parent (the daily page's sheet) can't shrink or clip it.
 */
export function ImageLightbox({ image, onClose }: { image: { src: string; alt: string }; onClose: () => void }) {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onClose()
		}
		document.addEventListener('keydown', onKeyDown)
		return () => document.removeEventListener('keydown', onKeyDown)
	}, [onClose])

	return createPortal(
		<div className="lb-agent-lightbox" role="dialog" aria-modal="true" aria-label={image.alt} onClick={onClose}>
			<img src={image.src} alt={image.alt} />
		</div>,
		document.body
	)
}
