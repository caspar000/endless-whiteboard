import { getGpuScene, getGpuSnapshots, getRendererMode, useEditor } from '@lifeboard/canvas'
import { useEffect, useRef, useState } from 'react'

/**
 * A dev-only performance readout for the board (docs/gpu-renderer-plan.md): frame times now and for
 * the last pan, long tasks, what the GPU layer is doing and how far the board is from ready. Off
 * unless asked for: `?perf=1` turns it on (kept in `localStorage['lifeboard:perf']`), `?perf=0` off.
 *
 * Frame times are the gaps between animation frames, so they count whatever kept the page from
 * drawing: scripts, layout, the GPU. A pan is from the camera's first move to 300 ms without one.
 */

const KEY = 'lifeboard:perf'
try {
	const asked = new URLSearchParams(location.search).get('perf')
	if (asked === '1') localStorage.setItem(KEY, '1')
	if (asked === '0') localStorage.removeItem(KEY)
} catch {
	// No storage: off.
}

const wanted = () => {
	try {
		return localStorage.getItem(KEY) === '1'
	} catch {
		return false
	}
}

export function PerfMonitor() {
	return wanted() ? <Readout /> : null
}

/** How long after the camera's last move a pan counts as over. */
const PAN_END_MS = 300
/** The window "now" covers. */
const WINDOW_MS = 2000

interface Pan {
	frames: number
	mean: number
	p95: number
	worst: number
	ms: number
}

const summarise = (gaps: number[]): Omit<Pan, 'ms'> => {
	const sorted = [...gaps].sort((a, b) => a - b)
	const n = sorted.length || 1
	return {
		frames: gaps.length,
		mean: sorted.reduce((a, b) => a + b, 0) / n,
		p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0,
		worst: sorted[sorted.length - 1] ?? 0,
	}
}

function Readout() {
	const editor = useEditor()
	const frames = useRef<{ t: number; gap: number }[]>([])
	const long = useRef<{ t: number; ms: number }[]>([])
	const lastPan = useRef<Pan | null>(null)
	const [, setTick] = useState(0)

	useEffect(() => {
		let raf = 0
		let last = 0
		let camera: unknown = null
		let movedAt = 0
		let pan: { gaps: number[]; start: number } | null = null
		const loop = (t: number) => {
			if (last) frames.current.push({ t, gap: t - last })
			last = t
			while (frames.current.length && frames.current[0]!.t < t - WINDOW_MS) frames.current.shift()
			const now = editor.getCamera()
			if (now !== camera) {
				camera = now
				movedAt = t
				pan ??= { gaps: [], start: t }
			}
			if (pan) {
				pan.gaps.push(frames.current[frames.current.length - 1]?.gap ?? 0)
				if (t - movedAt > PAN_END_MS) {
					// The frames after the last move, waiting to see it was the last, aren't the pan's.
					const gaps = pan.gaps.slice(0, Math.max(1, pan.gaps.length - Math.round(PAN_END_MS / 8.3)))
					if (gaps.length > 3) lastPan.current = { ...summarise(gaps), ms: movedAt - pan.start }
					pan = null
				}
			}
			raf = requestAnimationFrame(loop)
		}
		raf = requestAnimationFrame(loop)
		const observer =
			typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')
				? new PerformanceObserver((list) => {
						for (const e of list.getEntries()) long.current.push({ t: e.startTime, ms: e.duration })
					})
				: null
		observer?.observe({ type: 'longtask', buffered: false })
		const interval = setInterval(() => setTick((n) => n + 1), 250)
		return () => {
			cancelAnimationFrame(raf)
			observer?.disconnect()
			clearInterval(interval)
		}
	}, [editor])

	const now = performance.now()
	long.current = long.current.filter((e) => e.t > now - 5000)
	const recent = summarise(frames.current.map((f) => f.gap))
	const scene = getGpuScene(editor)
	const ready = getGpuSnapshots(editor).readiness.get()
	const pictures = scene.picturesLeft.get()
	const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize
	const mounted = editor.getContainer().querySelectorAll('.tl-shape:not(.tl-shape-background)').length
	const pan = lastPan.current
	const ms = (n: number) => n.toFixed(1)
	const fps = recent.mean ? Math.round(1000 / recent.mean) : 0

	return (
		<div className="lb-perf" aria-hidden="true">
			<div>
				<b>{fps} fps</b> · {ms(recent.mean)} ms, p95 {ms(recent.p95)}, worst {ms(recent.worst)}
			</div>
			<div>
				last pan:{' '}
				{pan ? `${ms(pan.mean)} ms, p95 ${ms(pan.p95)}, worst ${ms(pan.worst)} · ${pan.frames} frames in ${(pan.ms / 1000).toFixed(1)} s` : '—'}
			</div>
			<div>
				long tasks (5 s): {long.current.length} · {Math.round(long.current.reduce((a, b) => a + b.ms, 0))} ms
				{long.current.length ? `, worst ${Math.round(Math.max(...long.current.map((e) => e.ms)))}` : ''}
			</div>
			<div>
				renderer {getRendererMode()} · GPU layer <b>{scene.active.get() ? 'on' : 'off'}</b> · {scene.onScreen.get()} it could draw on screen
			</div>
			<div>
				GPU draws {scene.hidden.get().size} · page mounts {mounted} · {editor.getCurrentPageShapeIds().size.toLocaleString()} shapes
			</div>
			<div>
				{ready ? `read ${(ready.total - ready.waiting).toLocaleString()} / ${ready.total.toLocaleString()} around the screen · ${pictures} pictures left` : 'not preparing (GPU layer off)'}
			</div>
			<div>
				zoom {Math.round(editor.getZoomLevel() * 100)}%{heap ? ` · heap ${Math.round(heap / 1e6)} MB` : ''}
			</div>
		</div>
	)
}
