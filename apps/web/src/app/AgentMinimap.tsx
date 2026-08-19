import { useState } from 'react'

/**
 * A tick per message, down the transcript's right edge.
 *
 * T3 Code's minimap, adapted rather than ported — and the adaptation is the whole story. Theirs lives
 * in the *gutter* beside a centred content column, and its own sizing helper returns 0 (disabling the
 * rail) when that gutter is too narrow, precisely so the hover strip cannot sit on top of message text
 * and swallow pointer events. Our panel is a single column with no gutter at all, so a direct port
 * would switch itself off.
 *
 * The answer here was to make room: the panel grew by 12px and the transcript reserves that strip for
 * the rail. Nothing overlaps the messages, so there is no hit-testing hazard to engineer around, and
 * no reading width was spent to get it.
 *
 * Ticks are per *user message*, which in a board conversation is the natural landmark — "where did I
 * ask about the blender" — and keeps the rail legible at a handful of marks rather than hundreds.
 */

export interface MinimapMark {
	/** The row id, so clicking can find the element to scroll to. */
	id: string
	/** The message itself, truncated by the caller — shown on hover. */
	label: string
}

export function AgentMinimap({
	marks,
	onSelect,
}: {
	marks: readonly MinimapMark[]
	onSelect: (id: string) => void
}) {
	const [active, setActive] = useState<number | null>(null)

	// One mark is not a map of anything.
	if (marks.length < 2) return null

	return (
		<div className="lb-agent-minimap" aria-hidden="true">
			{marks.map((mark, index) => (
				<button
					key={mark.id}
					type="button"
					className="lb-agent-minimap__tick"
					data-active={active === index || undefined}
					// Not in the tab order and hidden from the reader: it is a shortcut to content that is
					// already reachable by scrolling, and the messages themselves are the accessible path.
					tabIndex={-1}
					onMouseEnter={() => setActive(index)}
					onMouseLeave={() => setActive((current) => (current === index ? null : current))}
					onClick={() => onSelect(mark.id)}
				/>
			))}
			{active !== null && marks[active] && (
				<span
					className="lb-agent-minimap__preview"
					// Positioned against the hovered tick rather than the pointer, so it does not jitter as
					// the mouse moves within one tick's hit area.
					style={{ top: `calc(${(active / Math.max(1, marks.length - 1)) * 100}% )` }}
				>
					{marks[active].label}
				</span>
			)}
		</div>
	)
}
