import { rollupStats } from '@lifeboard/node-kit'
import { useEffect, useState } from 'react'
import { useEditor } from 'tldraw'

/**
 * The dev-mode recompute counter from §4.3 — milestone 6's acceptance check and the standing
 * regression tripwire for rollup churn.
 *
 * How to read it: select an item node and drag it around. `agg` must not move. If it climbs, the
 * facts `isEqual` stage has been broken and every rollup on the board is re-aggregating on every
 * pointer move.
 */
export function RollupDebugBadge() {
	const editor = useEditor()
	const [counts, setCounts] = useState({ facts: 0, agg: 0 })
	const [dragBaseline, setDragBaseline] = useState<{ facts: number; agg: number } | null>(null)

	useEffect(() => {
		const id = setInterval(
			() => setCounts({ facts: rollupStats.factsRecomputes, agg: rollupStats.aggregateRecomputes }),
			200
		)
		return () => clearInterval(id)
	}, [])

	// Snapshot the counters when a drag starts so the badge can show the delta *for that drag*,
	// which is the number the acceptance check cares about.
	useEffect(() => {
		const onPointerDown = () =>
			setDragBaseline({ facts: rollupStats.factsRecomputes, agg: rollupStats.aggregateRecomputes })
		const container = editor.getContainer()
		container.addEventListener('pointerdown', onPointerDown)
		return () => container.removeEventListener('pointerdown', onPointerDown)
	}, [editor])

	const delta = dragBaseline
		? { facts: counts.facts - dragBaseline.facts, agg: counts.agg - dragBaseline.agg }
		: null

	return (
		<div className="lb-debug-badge" title="Rollup recomputes — 'agg' must stay flat while dragging">
			<span>facts {counts.facts}</span>
			<span>agg {counts.agg}</span>
			{delta && (
				<span className={delta.agg === 0 ? 'lb-debug-badge__ok' : 'lb-debug-badge__warn'}>
					since drag: +{delta.facts}/+{delta.agg}
				</span>
			)}
		</div>
	)
}
