import { useEffect, useState, type ImgHTMLAttributes, type ReactNode } from 'react'

/** URLs already decoded on this page: one coming back (a shape mounting again) shows at once. */
const decoded = new Set<string>()

/**
 * A picture that shows its blurred placeholder at once and swaps to the picture once it has decoded,
 * so it never appears half drawn (docs/image-loading-plan.md). With no placeholder, the picture
 * fades in instead of appearing in one frame.
 *
 * A new `src` for the same picture (a sharper copy after a zoom) keeps the one on screen until the new
 * one has decoded. The blur is in the placeholder image itself, not a CSS filter, which the GPU layer
 * can't draw; the fade's class comes off when it ends, and that change makes the GPU layer read the
 * shape again at full opacity. `fallback` stands in while there is nothing to show yet.
 *
 * @public
 */
export function BlurUpImage({
	src,
	placeholder,
	fallback = null,
	className,
	...rest
}: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'placeholder'> & {
	src: string | null
	placeholder?: string | null
	fallback?: ReactNode
}) {
	const [ready, setReady] = useState(() => (src && decoded.has(src) ? src : null))
	const [fading, setFading] = useState(false)

	useEffect(() => {
		if (!src || src === ready) return
		if (decoded.has(src)) {
			setReady(src)
			return
		}
		let cancelled = false
		const image = new Image()
		image.src = src
		// A picture that won't decode still goes in, so the page shows what it would have shown.
		void image
			.decode()
			.catch(() => undefined)
			.then(() => {
				if (cancelled) return
				decoded.add(src)
				if (!ready && !placeholder) setFading(true)
				setReady(src)
			})
		return () => {
			cancelled = true
		}
	}, [src, ready, placeholder])

	const shown = (src && ready) || placeholder
	if (!shown) return fallback
	return (
		<img
			{...rest}
			className={fading ? `${className ?? ''} tl-blur-up--fade` : className}
			src={shown}
			onAnimationEnd={() => setFading(false)}
		/>
	)
}
