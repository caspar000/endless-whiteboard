import { modulate, suffixSafeId, useEditor, useUniqueSafeId, useValue } from 'tldraw'

/**
 * The default dotted-paper grid — the `lifeboard` grid style (see CanvasBackground.tsx).
 *
 * Drawn here rather than by turning on tldraw's grid mode, which produces a similar dot pattern but
 * cannot be separated from snapping: one flag does both. Keeping our own means the grid is decoration
 * and snapping is a choice, which is why they are two settings rather than one.
 *
 * The pattern is anchored in *page* space, so the dots pan and zoom with the board like real paper
 * instead of sliding underneath it. Two densities are drawn, with the finer one fading out as you zoom
 * away, which keeps the texture even instead of turning into noise at low zoom.
 */

/** Dot spacing in page units, coarse first. `fadeFrom`/`fadeTo` are zoom levels. */
const LAYERS = [
	{ spacing: 100, radius: 1.2, fadeFrom: 0.05, fadeTo: 0.25, opacity: 0.9 },
	{ spacing: 20, radius: 1, fadeFrom: 0.35, fadeTo: 0.8, opacity: 0.7 },
] as const

export function DottedPaper() {
	const editor = useEditor()

	/*
	 * Unique per instance, and load-bearing.
	 *
	 * The shell keeps one editor mounted per open tab, so several of these SVGs share one document. With
	 * a fixed pattern id they collided: every board's `url(#…)` resolved to whichever copy came first in
	 * document order, and since inactive boards are hidden with `visibility: hidden`, the circles inside
	 * that first pattern inherited it and painted nothing. The result was a grid on exactly one board and
	 * bare paper on all the others — including every newly created one.
	 */
	const patternId = useUniqueSafeId('lb-paper-dots')

	// Re-reads on every camera change, exactly as tldraw's own grid does. Cheap: it only recomputes
	// a handful of numbers and lets the browser tile the pattern.
	const camera = useValue('lifeboard:paper-camera', () => editor.getCamera(), [editor])

	return (
		<svg className="lb-paper" aria-hidden="true">
			<defs>
				{LAYERS.map(({ spacing, radius, fadeFrom, fadeTo, opacity }, i) => {
					const step = spacing * camera.z
					// Offset the pattern by the camera so dots stay pinned to page coordinates.
					const offsetX = ((camera.x * camera.z) % step + step) % step
					const offsetY = ((camera.y * camera.z) % step + step) % step
					const fade =
						camera.z <= fadeFrom
							? 0
							: camera.z >= fadeTo
								? 1
								: modulate(camera.z, [fadeFrom, fadeTo], [0, 1])

					if (fade === 0) return null

					return (
						<pattern
							key={i}
							id={suffixSafeId(patternId, String(i))}
							width={step}
							height={step}
							patternUnits="userSpaceOnUse"
						>
							<circle
								className="lb-paper__dot"
								cx={offsetX}
								cy={offsetY}
								// Dot size grows with zoom but is clamped, so dots read as texture rather
								// than as blobs when you zoom right in.
								r={Math.min(radius * Math.max(camera.z, 0.5), 2.4)}
								opacity={fade * opacity}
							/>
						</pattern>
					)
				})}
			</defs>
			{LAYERS.map((_, i) => (
				<rect
					key={i}
					width="100%"
					height="100%"
					fill={`url(#${suffixSafeId(patternId, String(i))})`}
				/>
			))}
		</svg>
	)
}
