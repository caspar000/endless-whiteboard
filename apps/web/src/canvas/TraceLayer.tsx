import { forwardRef, useEffect } from 'react'
import {
	DefaultShapeWrapper,
	useEditor,
	useValue,
	type Editor,
	type TLShapeWrapperProps,
} from 'tldraw'
import { loopOutline, tracedOutlines, type TracedOutlines } from './auraGeometry'
import { useAuraPhase } from './auraPhase'
import { getAuraPreset, type AuraPreset } from './auraPreset'
import { getTrace, isTracing, setTracing, traceRoleFor } from './tracing'

/**
 * What the tracing lens looks like.
 *
 * Two halves, deliberately separate:
 *
 *  - **The marking** — every shape is told whether it is in the trace, via a `data-lb-trace`
 *    attribute on its own container. Everything about how that reads (the dim, the transition) is
 *    then CSS, which is the layer worth arguing about taste in.
 *  - **The aura** — a drawn, moving outline around the traced group. Not a drop-shadow: a static glow
 *    reads as a selection highlight, and the whole point of this being a *lens* is that it looks like
 *    something switched on.
 */

/**
 * Every shape's container, told whether it is part of the trace.
 *
 * Overriding `ShapeWrapper` rather than injecting a stylesheet of generated `[data-shape-id="…"]`
 * rules: this way the mark travels with the shape, needs no per-shape-util change, and reaches
 * shapes a plugin invents later. Every wrapper subscribes to the trace — a lot of subscribers, but
 * they only fire when the trace changes, which is a deliberate click rather than a drag frame.
 */
export const TraceShapeWrapper = forwardRef<HTMLDivElement, TLShapeWrapperProps>(
	function TraceShapeWrapper({ shape, ...props }, ref) {
		const editor = useEditor()
		const role = useValue(
			`lifeboard:trace-role-${shape.id}`,
			() => traceRoleFor(editor, shape.id),
			[editor, shape.id]
		)
		return (
			<DefaultShapeWrapper
				ref={ref}
				shape={shape}
				{...props}
				// Spread rather than written inline: a `data-*` attribute is not part of
				// `TLShapeWrapperProps`, and React only allows arbitrary ones on intrinsic elements.
				{...(role ? { 'data-lb-trace': role } : {})}
			/>
		)
	}
)

/** Escape leaves the lens. A mode you cannot get out of by reflex is a trap. */
function useEscapeExits(): void {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape' || !isTracing()) return
			// Not prevented: tldraw's own Escape — deselect, cancel an edit — should still happen.
			setTracing(false)
		}
		window.addEventListener('keydown', onKeyDown, { capture: true })
		return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
	}, [])
}

export function TraceLayer() {
	const editor = useEditor()
	useEscapeExits()

	// The look. A signal, so a slider in Settings → Canvas → Advanced repaints this immediately.
	const preset = useValue('lifeboard:aura-preset', () => getAuraPreset(), [])

	// Page-space geometry of everything in the trace, rebuilt when the trace or any traced shape
	// moves. A view concern: it is *expected* to follow a drag, which is why it reads bounds directly
	// rather than going anywhere near the facts pipeline.
	const outlines = useValue(
		'lifeboard:aura-geometry',
		() => tracedGeometry(editor, preset),
		[editor, preset]
	)

	const phase = useAuraPhase(outlines !== null && preset.drift > 0)
	if (!outlines) return null

	return (
		<svg
			className="lb-aura"
			// Sized and placed to the traced group's own box, so the coordinates inside are local and
			// the browser has a small, explicit area to paint rather than an unbounded one.
			style={{
				transform: `translate(${outlines.box.x}px, ${outlines.box.y}px)`,
				width: outlines.box.w,
				height: outlines.box.h,
				// Both live on the preset so the tuner can reach them; `softness` of 0 means no filter
				// at all rather than a zero-radius blur the browser would still set up a pass for.
				strokeWidth: preset.stroke,
				...(preset.softness > 0
					? { filter: `drop-shadow(0 0 ${preset.softness}px var(--lb-glow))` }
					: {}),
			}}
			viewBox={`0 0 ${outlines.box.w} ${outlines.box.h}`}
			aria-hidden="true"
		>
			{outlines.loops.length > 0 && (
				<path
					className="lb-aura__blob"
					// A wash inside the outline. `fill-opacity` rather than a mixed colour so it stays one
					// paint and needs no `color-mix` support; the layer is behind the shapes, so what you
					// see of it is the ring between the outline and the card.
					fillOpacity={preset.fill / 100}
					/*
					 * Every loop in one path, so `evenodd` can do its job: a gap enclosed by three shapes
					 * arrives as a loop *inside* another one, and should read as a hole rather than being
					 * filled in. Separate paths could not know about each other.
					 */
					fillRule="evenodd"
					d={outlines.loops
						.map((loop, i) => loopOutline(loop, phase, outlines.seed + i * 0.37, preset))
						.filter(Boolean)
						.join(' ')}
				/>
			)}
		</svg>
	)
}

/**
 * The traced shapes as page-space geometry, or `null` when nothing is traced.
 *
 * Kept out of the component so the render is only about drawing. Coordinates come back relative to
 * the group's bounding box, which is what lets the SVG be small and positioned rather than an
 * invisible sheet the size of the canvas.
 */
function tracedGeometry(editor: Editor, preset: AuraPreset): TracedOutlines | null {
	const trace = getTrace(editor).get()
	if (!trace) return null
	return tracedOutlines(editor, trace, preset)
}
