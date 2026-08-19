import { describeContext, formatPercent, formatTokens, snapshot, type ContextUsage } from '../agent/context'

/**
 * How full the context window is, as a ring.
 *
 * T3 Code's control, and worth copying because of what it replaces: without it, a conversation's only
 * symptom of a full window is the model quietly getting worse at remembering the beginning. The ring
 * makes "start a new chat" a decision the user can time rather than one they make after being burnt.
 *
 * It appears only once a turn has reported — before that there is nothing to be a fraction *of*, and
 * an empty ring beside an empty transcript would be chrome pretending to be information.
 */
export function AgentContextMeter({ usage }: { usage: ContextUsage }) {
	const snap = snapshot(usage)
	const label = describeContext(snap)

	// 24-unit box, matching the panel's other icon buttons. The radius leaves room for a 3-wide stroke
	// to sit fully inside the viewBox rather than being clipped at the top and bottom.
	const radius = 9.75
	const circumference = 2 * Math.PI * radius
	// A `null` percentage means the window size is unknown, so the arc stays empty and the tooltip
	// carries the raw token count instead — better than a ring implying a fraction nobody measured.
	const filled = snap.percent ?? 0

	return (
		<span
			className="lb-agent-meter"
			data-crowded={snap.crowded || undefined}
			title={label}
			aria-label={label}
			role="img"
		>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<circle className="lb-agent-meter__track" cx="12" cy="12" r={radius} fill="none" strokeWidth="3" />
				<circle
					className="lb-agent-meter__fill"
					cx="12"
					cy="12"
					r={radius}
					fill="none"
					strokeWidth="3"
					strokeLinecap="round"
					strokeDasharray={circumference}
					// Drawn anticlockwise from zero, so the arc grows the way a dial does. The rotation that
					// starts it at twelve o'clock is in CSS.
					strokeDashoffset={circumference * (1 - filled / 100)}
				/>
			</svg>
			{/* The figure in text as well as in the arc: a ring alone cannot be read at a glance below
			    about 10%, which is where a conversation spends most of its life. */}
			<span className="lb-agent-meter__figure">
				{snap.percent === null ? formatTokens(snap.used) : formatPercent(snap.percent)}
			</span>
		</span>
	)
}
