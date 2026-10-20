// Frame times of the prototype at N copies of the board (GPU flags on). Run from apps/web with the
// prototype served on :5400: cp ../../prototypes/gpu-canvas/bench.mjs . && node bench.mjs 1 29 287
import { chromium } from '@playwright/test'
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--enable-gpu'] })
for (const copies of process.argv.slice(2).map(Number)) {
	const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 2 })
	const errors = []
	page.on('pageerror', (e) => errors.push(String(e)))
	const t0 = Date.now()
	await page.goto(`http://127.0.0.1:5400/?copies=${copies}`)
	await page.waitForFunction(() => window.proto?.ready, null, { timeout: 300000 })
	const load = Date.now() - t0
	const pan = (label) => page.evaluate(async (label) => {
		const p = window.proto
		const times = []
		let last = performance.now()
		for (let i = 0; i < 120; i++) {
			await new Promise((r) => requestAnimationFrame(r))
			const now = performance.now(); times.push(now - last); last = now
			const c = p.getCamera()
			p.setCamera({ x: c.x + (i < 60 ? 8 : -8) / c.z })
		}
		times.sort((a, b) => a - b)
		const g = p.stats.gpuSamples.splice(0).sort((a, b) => a - b)
		const gpu = g.length ? `gpu avg ${(g.reduce((a, b) => a + b, 0) / g.length).toFixed(2)} / max ${g[g.length - 1].toFixed(2)} ms` : 'gpu ?'
		return `${label}: avg ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(1)} ms, p95 ${times[Math.floor(times.length * 0.95)].toFixed(1)} ms · ${gpu} · ${p.stats.drawCalls} draws, encode ${p.stats.cpuMs.toFixed(2)} ms`
	}, label)
	const zoom = (label) => page.evaluate(async (label) => {
		const p = window.proto
		const times = []
		let last = performance.now()
		for (let i = 0; i < 120; i++) {
			await new Promise((r) => requestAnimationFrame(r))
			const now = performance.now(); times.push(now - last); last = now
			const c = p.getCamera(); const f = i < 60 ? 1.02 : 1 / 1.02
			const cx = innerWidth / 2 / c.z - c.x, cy = innerHeight / 2 / c.z - c.y
			const z = c.z * f
			p.setCamera({ z, x: innerWidth / 2 / z - cx, y: innerHeight / 2 / z - cy })
		}
		times.sort((a, b) => a - b)
		return `${label}: avg ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(1)} ms, p95 ${times[Math.floor(times.length * 0.95)].toFixed(1)} ms`
	}, label)
	const at = async (z) => {
		await page.evaluate((z) => (z ? window.proto.focus(z) : window.proto.zoomToFit()), z)
		await page.waitForTimeout(400)
	}
	console.log(`--- ${copies} copies, ${(copies * 3490).toLocaleString()} shapes, loaded in ${load} ms`)
	await page.evaluate(() => window.proto.stats.gpuSamples.splice(0))
	await at(0); console.log(await pan('fit (' + (await page.evaluate(() => (window.proto.getCamera().z * 100).toPrecision(2))) + '%)'))
	await at(0); console.log(await zoom('zoom in/out from fit'))
	for (const z of [0.1, 0.25, 0.5, 1]) { await at(z); console.log(await pan(`${z * 100}%`)) }
	if (errors.length) console.log('errors', errors.slice(0, 2))
	await page.close()
}
await browser.close()
