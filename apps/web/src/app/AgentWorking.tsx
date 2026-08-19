import { ChevronRight, Clock } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { formatElapsed } from '../agent/transcript'

/**
 * The live "Working for 1m 4s" row, and the "Worked for 4m 12s" disclosure a finished turn folds into.
 *
 * Both replace what used to be a stack of `Thinking…` rows: while a turn runs there is one line that
 * says how long it has been going and what it is doing; once it ends, the same span becomes one line
 * you can open if you want to see the work again.
 */

/**
 * The elapsed label, ticking itself.
 *
 * The interval writes `textContent` on a ref rather than setting state, and that is deliberate: the
 * transcript already re-renders on every streamed delta, and adding a second-by-second React commit
 * on top of that would re-render every row in the panel once a second for the life of a turn. T3 Code
 * makes the same call, and says so in its source.
 */
function ElapsedTicker({ startedAt }: { startedAt: number }) {
	const node = useRef<HTMLSpanElement>(null)

	useEffect(() => {
		const write = () => {
			if (node.current) node.current.textContent = formatElapsed(Date.now() - startedAt)
		}
		write()
		const timer = setInterval(write, 1000)
		return () => clearInterval(timer)
	}, [startedAt])

	// Rendered with its starting value so the first paint is not blank before the effect runs.
	return <span ref={node}>{formatElapsed(Date.now() - startedAt)}</span>
}

/**
 * Three dots that stutter rather than fade.
 *
 * Staggered by 200ms on a stepped keyframe — copied from T3 Code because the *stutter* is what reads
 * as a machine working. A smooth sine fade reads as decoration.
 */
function PulsingDots() {
	return (
		<span className="lb-agent-dots" aria-hidden="true">
			<span />
			<span />
			<span />
		</span>
	)
}

export function AgentWorkingRow({
	startedAt,
	step,
}: {
	startedAt: number
	/** What it last said it was doing. Absent once it has moved on to a tool call or a reply. */
	step: string | null
}) {
	return (
		<div className="lb-agent-working" role="status">
			<PulsingDots />
			<span className="lb-agent-working__label">
				{/* A turn replayed from disk has no start time, so it says what it is doing and not for
				    how long — a counter from the epoch would be worse than none. */}
				{startedAt > 0 ? (
					<>
						Working for <ElapsedTicker startedAt={startedAt} />
					</>
				) : (
					'Working'
				)}
			</span>
			{step && <span className="lb-agent-working__step">· {step}</span>}
		</div>
	)
}

/**
 * A settled turn's fold.
 *
 * Closed by default. What it hides is the work and the commentary — never the reply, which stays
 * below it, because the answer is the thing you came back for.
 */
export function AgentFoldRow({
	label,
	count,
	open,
	onToggle,
}: {
	label: string
	/** How many items are behind it, so a closed fold says how much it is hiding. */
	count: number
	open: boolean
	onToggle: () => void
}) {
	return (
		<button
			type="button"
			className="lb-agent-fold"
			data-open={open || undefined}
			aria-expanded={open}
			// Expanding must not move the transcript under the pointer — see `overflow-anchor` on the
			// transcript and the matching attribute on the other expanders.
			data-scroll-anchor-ignore
			onClick={onToggle}
		>
			<ChevronRight size={12} aria-hidden="true" className="lb-agent-fold__chevron" />
			<Clock size={11} aria-hidden="true" />
			<span className="lb-agent-fold__label">{label}</span>
			{!open && <span className="lb-agent-fold__count">{count}</span>}
		</button>
	)
}
