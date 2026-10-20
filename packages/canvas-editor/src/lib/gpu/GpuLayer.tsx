import { react } from '@tldraw/state'
import { useValue } from '@tldraw/state-react'
import { modulate } from '@tldraw/utils'
import React from 'react'
import { useEditor } from '../hooks/useEditor'
import { getRendererMode } from '../editor/rendererMode'
import { getGpuScene } from './gpuScene'
import { GpuRenderer, type GpuView } from './GpuRenderer'
import { gpuColor } from './primitives'

/**
 * The GPU layer (docs/gpu-renderer-plan.md): a WebGL2 canvas over the shapes the page draws and under
 * the overlays (selection, handles), drawing the shapes the scene gives it.
 *
 * In the page only while the scene wants it (`GpuScene.wanted`: the board shown, the browser able, the
 * renderer asking, or `auto` over its budget). Over the shapes, not under: a WebGL canvas under them
 * made the browser composite the shape layer apart and rasterise it at another scale, which blurred
 * the page's thin lines zoomed out (phase 3). Over them, the page draws exactly as without it. With
 * the GPU off there is no canvas at all; leaving frees the context (a browser allows a handful).
 */
export function GpuLayer() {
	const editor = useEditor()
	const wanted = useValue('gpu layer wanted', () => getGpuScene(editor).wanted.get(), [editor])
	const compare = useValue('gpu layer compare', () => getRendererMode() === 'compare', [])
	if (!wanted) return null
	return <GpuCanvas compare={compare} />
}

/**
 * Drawn in a microtask after anything it shows changes, which is still before the browser paints
 * that frame, so it moves with the page's camera transform, never a frame behind. A lost context
 * hands every shape back to the page until it's restored.
 *
 * The canvas is made here and removed on the way out, so each run of the effect (React runs them
 * twice in development) has a canvas of its own and a context that was never given back.
 */
function GpuCanvas({ compare }: { compare: boolean }) {
	const editor = useEditor()
	const rHost = React.useRef<HTMLDivElement>(null)
	const rCanvas = React.useRef<HTMLCanvasElement | null>(null)

	React.useEffect(() => {
		const host = rHost.current
		if (!host) return
		const canvas = document.createElement('canvas')
		canvas.className = 'tl-gpu-layer'
		canvas.setAttribute('aria-hidden', 'true')
		host.appendChild(canvas)
		rCanvas.current = canvas
		const scene = getGpuScene(editor)
		let renderer: GpuRenderer | null = null
		let queued = false

		const start = () => {
			const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false, alpha: true })
			if (!gl || gl.isContextLost()) return
			try {
				renderer = new GpuRenderer(gl)
			} catch (error) {
				editor.annotateError(error, { origin: 'gpu.layer', willCrashApp: false })
				renderer = null
				return
			}
			scene.starts++
			scene.layerUp.set(true)
		}

		const draw = () => {
			queued = false
			if (!renderer) return
			const { x, y, z } = editor.getCamera()
			// The same offset the shape layer is moved by ("position layers" in Canvas.tsx).
			const offset = z >= 1 ? modulate(z, [1, 8], [0.125, 0.5], true) : modulate(z, [0.1, 1], [-2, 0.125], true)
			const bounds = editor.getViewportScreenBounds()
			const dpr = editor.getDevicePixelRatio()
			const width = Math.max(1, Math.round(bounds.w * dpr))
			const height = Math.max(1, Math.round(bounds.h * dpr))
			if (canvas.width !== width) canvas.width = width
			if (canvas.height !== height) canvas.height = height
			renderer.setFrame(scene.frame.get())
			// What the page's halos read: the zoom it was last told (debounced on big boards) and the paper's colour.
			const haloZoom = Number(container.style.getPropertyValue('--tl-zoom')) || z
			const view: GpuView = { tx: x + offset, ty: y + offset, z, width: bounds.w, height: bounds.h, dpr, haloZoom, background }
			renderer.draw(view)
		}

		const schedule = () => {
			if (queued) return
			queued = true
			queueMicrotask(draw)
		}

		// The paper's colour, read when the theme changes (once its new value is in: a frame later),
		// not on every frame, which would make the browser work out the styles each time.
		const container = editor.getContainer()
		let background = gpuColor(getComputedStyle(container).getPropertyValue('--color-background'))
		const stopTheme = react('gpu layer theme', () => {
			editor.user.getIsDarkMode()
			requestAnimationFrame(() => {
				background = gpuColor(getComputedStyle(container).getPropertyValue('--color-background'))
				schedule()
			})
		})
		// `--tl-zoom` follows the camera late on big boards (useZoomCss): a halo redraws when it lands.
		const zoomWatch = new MutationObserver(schedule)
		zoomWatch.observe(container, { attributes: true, attributeFilter: ['style'] })

		const onLost = (e: Event) => {
			e.preventDefault()
			renderer = null
			scene.layerUp.set(false)
		}
		const onRestored = () => {
			start()
			schedule()
		}
		canvas.addEventListener('webglcontextlost', onLost)
		canvas.addEventListener('webglcontextrestored', onRestored)
		start()

		// Anything drawn depends on these; reading them here wakes `schedule` when one changes.
		const stop = react('gpu layer draw', () => {
			editor.getCamera()
			editor.getViewportScreenBounds()
			editor.getDevicePixelRatio()
			scene.frame.get()
			schedule()
		})

		return () => {
			stop()
			stopTheme()
			zoomWatch.disconnect()
			canvas.removeEventListener('webglcontextlost', onLost)
			canvas.removeEventListener('webglcontextrestored', onRestored)
			scene.layerUp.set(false)
			// Given back now rather than whenever the canvas is collected.
			renderer?.gl.getExtension('WEBGL_lose_context')?.loseContext()
			renderer = null
			canvas.remove()
			rCanvas.current = null
		}
	}, [editor])

	React.useEffect(() => {
		rCanvas.current?.classList.toggle('tl-gpu-layer--compare', compare)
	}, [compare])

	// `display: contents`: the canvas sits in the canvas's own stacking order, over the shapes, under the overlays.
	return <div ref={rHost} style={{ display: 'contents' }} />
}
