import { useEffect, useRef } from 'react'
import { curlRadius, drawAngledCurl } from './curl'
import type { ReaderSettings } from './settings'

/**
 * The page you are leaving, curling off the screen.
 *
 * A canvas laid over the page area, holding one picture: the sheet being turned. Whatever it does
 * not cover is transparent, so the page underneath is the real thing — already rendered, already
 * selectable the moment the curl is over.
 *
 * The sheet is always the one being *left*, in both directions; going back it curls off the other
 * edge. Turning a page backwards is not a thing paper does, so there is no physical answer to copy,
 * and this one has the practical virtue that the picture it needs is always already on screen.
 */
export function PageCurl({
	texture,
	textureWidth,
	textureHeight,
	width,
	height,
	back,
	paper,
	settings,
	onDone,
}: {
	/** The page being left, as pixels. */
	texture: CanvasImageSource
	textureWidth: number
	textureHeight: number
	width: number
	height: number
	back: boolean
	paper: string
	settings: ReaderSettings
	onDone(): void
}) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null)
	const onDoneRef = useRef(onDone)
	onDoneRef.current = onDone

	useEffect(() => {
		const canvas = canvasRef.current
		const ctx = canvas?.getContext('2d')
		if (!canvas || !ctx) return

		const dpr = Math.min(2, window.devicePixelRatio || 1)
		canvas.width = Math.ceil(width * dpr)
		canvas.height = Math.ceil(height * dpr)
		ctx.scale(dpr, dpr)

		// Two working canvases at the page's diagonal, so a leaning fold has room to turn in. Made
		// once for the whole animation rather than per frame, which would churn a megabyte a tick.
		const span = Math.ceil(Math.hypot(width, height))
		const scratch = [0, 1].map(() => {
			const board = document.createElement('canvas')
			board.width = span
			board.height = span
			return board.getContext('2d')
		})
		const [straighten, roll] = scratch
		if (!straighten || !roll) return

		const options = {
			radius: curlRadius(width, settings.curlRadius),
			back,
			paper,
			shadow: settings.pageShadow,
			angle: back ? -settings.curlAngle : settings.curlAngle,
		}
		const duration = Math.max(80, settings.turnMs)
		let frame = 0
		let start = 0

		const step = (now: number) => {
			if (!start) start = now
			// Eased so the sheet leaves briskly and settles, rather than travelling at one speed.
			const linear = Math.min(1, (now - start) / duration)
			const progress = 1 - Math.pow(1 - linear, 3)
			drawAngledCurl(
				ctx,
				straighten,
				roll,
				texture,
				textureWidth,
				textureHeight,
				width,
				height,
				progress,
				options
			)
			if (linear < 1) frame = requestAnimationFrame(step)
			else onDoneRef.current()
		}
		frame = requestAnimationFrame(step)
		return () => cancelAnimationFrame(frame)
	}, [texture, textureWidth, textureHeight, width, height, back, paper, settings])

	return <canvas className="lb-reader__curl" ref={canvasRef} style={{ width, height }} aria-hidden />
}
