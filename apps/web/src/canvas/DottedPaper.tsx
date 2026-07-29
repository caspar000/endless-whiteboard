import { modulate, useEditor, useValue } from 'tldraw'

/**
 * The canvas's dotted-paper backdrop.
 *
 * Implemented as a `Background` component rather than by turning on tldraw's grid mode, which draws a
 * near-identical dot pattern: grid mode also snaps translation and resizing to the grid, and it is a
 * user-facing toggle. Neither belongs in "the paper has texture" — the dots are decoration, not a
 * constraint, and they should not be switchable off by a menu item about snapping.
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
							id={`lb-paper-dots-${i}`}
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
				<rect key={i} width="100%" height="100%" fill={`url(#lb-paper-dots-${i})`} />
			))}
		</svg>
	)
}
