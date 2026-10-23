import { getGpuScene, getGpuSnapshots, useValue, type Editor } from '@lifeboard/canvas'
import { Check, LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'

/**
 * How far a big board is from panning at full speed (docs/gpu-renderer-plan.md, phase 10a), in the
 * board's corner beside the sync status. On a board big enough for the GPU layer, each shape around
 * the screen is drawn by the page until the layer has read it, and each picture is rastered the first
 * time it's seen; until then a pan is slower. The board works meanwhile.
 *
 * - Shapes still being read: how many of those around the screen are ready.
 * - Then pictures still to be rastered at this zoom.
 * - Then "Board ready", briefly.
 *
 * Shown only once preparing has taken a moment, so a small board, or a big one that's ready, never
 * flashes it. Around the screen, not the whole board: a jump elsewhere starts it again.
 */
export function BoardPreparingPill({ editor }: { editor: Editor }) {
	const state = useValue(
		'board preparing',
		() => {
			const shapes = getGpuSnapshots(editor).readiness.get()
			if (!shapes) return null
			return { ...shapes, pictures: getGpuScene(editor).picturesLeft.get() }
		},
		[editor]
	)
	const busy = !!state && (state.waiting > 0 || state.pictures > 0)
	const [shown, setShown] = useState(false)
	const [ready, setReady] = useState(false)

	// Busy for a moment: shown.
	useEffect(() => {
		if (!busy) return
		setReady(false)
		const timer = setTimeout(() => setShown(true), SHOW_AFTER_MS)
		return () => clearTimeout(timer)
	}, [busy])
	// Done after it showed: "Board ready" instead, for a moment.
	useEffect(() => {
		if (busy || !shown) return
		setShown(false)
		setReady(true)
	}, [busy, shown])
	useEffect(() => {
		if (!ready) return
		const timer = setTimeout(() => setReady(false), READY_MS)
		return () => clearTimeout(timer)
	}, [ready])

	if (shown && state) {
		const detail =
			state.waiting > 0
				? `${(state.total - state.waiting).toLocaleString()} / ${state.total.toLocaleString()} shapes`
				: `${state.pictures.toLocaleString()} ${state.pictures === 1 ? 'picture' : 'pictures'} left`
		return (
			<div className="lb-sync-pill lb-sync-pill--saving lb-board-pill--explained" role="status" title={EXPLAINED} data-testid="lb.board-preparing">
				<LoaderCircle size={13} />
				<span>Preparing board</span>
				{/* Not read out: it changes several times a second. */}
				<span className="lb-board-pill__detail" aria-hidden="true">
					{detail}
				</span>
			</div>
		)
	}
	if (ready) {
		return (
			<div className="lb-sync-pill lb-sync-pill--synced" role="status" data-testid="lb.board-preparing">
				<Check size={13} />
				<span>Board ready</span>
			</div>
		)
	}
	return null
}

/** How long preparing has to take before it shows. */
const SHOW_AFTER_MS = 1000
/** How long "Board ready" stays. */
const READY_MS = 1500

const EXPLAINED =
	'Lifeboard is getting the shapes around the screen ready to draw fast. The board works meanwhile; panning is smoother once it’s done.'
