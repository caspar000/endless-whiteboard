// Exports the four-tree test board as drawn primitives (data/four-trees.json). Run from apps/web against
// a dev server: cp ../../prototypes/gpu-canvas/export.mjs . && node export.mjs [port]
import { chromium } from '@playwright/test'
const port = process.argv[2] ?? '5391'
const browser = await chromium.launch()
const page = await browser.newPage({ colorScheme: 'dark', viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.addInitScript(() => localStorage.setItem('lifeboard:sidebar:collapsed', 'true'))
await page.goto(`http://localhost:${port}/`)
await page.locator('.tl-canvas:visible').waitFor({ timeout: 30000 })
await page.locator('.lb-tabs__close').click()
await page.locator('.lb-home__header').waitFor()
await page.getByRole('button', { name: 'New board' }).first().click()
await page.locator('.tl-canvas:visible').waitFor()
await page.keyboard.press('ControlOrMeta+Shift+k')
await page.locator('.lb-palette__input').type('whole-life test')
await page.waitForTimeout(400)
await page.keyboard.press('Enter')
await page.waitForTimeout(20000)
await page.mouse.click(1500, 80)
await page.evaluate(() => { window.editor.zoomToFit() })
await page.waitForTimeout(2000)
const scene = await page.evaluate(() => {
	const e = window.editor
	const toPage = (x, y) => e.screenToPage({ x, y })
	const rgba = (c) => {
		const m = c.match(/rgba?\(([^)]+)\)/)
		if (!m) return [0, 0, 0, 0]
		const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number)
		return [p[0] / 255, p[1] / 255, p[2] / 255, p.length > 3 ? p[3] : 1]
	}
	const out = { discs: [], rings: [], texts: [], lines: [], background: rgba(getComputedStyle(document.querySelector('.tl-background') || document.body).backgroundColor) }
	const z = e.getZoomLevel()
	for (const el of document.querySelectorAll('.lb-skillnode__disc, .lb-entry__disc, .lb-work__disc')) {
		const r = el.getBoundingClientRect()
		if (!r.width) continue
		const s = getComputedStyle(el)
		const c = toPage(r.x + r.width / 2, r.y + r.height / 2)
		out.discs.push([c.x, c.y, r.width / 2 / z, ...rgba(s.backgroundColor), ...rgba(s.borderTopColor), parseFloat(s.borderTopWidth) || 0, s.borderTopStyle === 'dashed' ? 1 : 0])
	}
	for (const svg of document.querySelectorAll('.lb-skillnode__ring, .lb-entry__ring')) {
		const r = svg.getBoundingClientRect()
		if (!r.width) continue
		const c = toPage(r.x + r.width / 2, r.y + r.height / 2)
		const scale = r.width / 100 / z
		for (const circle of svg.querySelectorAll('circle')) {
			const s = getComputedStyle(circle)
			if (s.stroke === 'none' || s.display === 'none') continue
			const dash = (circle.getAttribute('stroke-dasharray') || '').split(/[\s,]+/).map(Number)
			const rad = Number(circle.getAttribute('r'))
			const fraction = circle.getAttribute('stroke-dasharray') ? Math.min(1, dash[0] / (2 * Math.PI * rad)) : 1
			if (fraction <= 0) continue
			out.rings.push([c.x, c.y, rad * scale, parseFloat(s.strokeWidth) * scale, ...rgba(s.stroke), fraction])
		}
	}
	for (const el of document.querySelectorAll('.lb-skillnode__name, .lb-skillnode__caption, .lb-entry__title, .lb-entry__count, .lb-work__title')) {
		const s = getComputedStyle(el)
		const node = [...el.childNodes].find((n) => n.nodeType === 3)
		if (!node || !node.textContent.trim()) continue
		const size = parseFloat(s.fontSize)
		const range = document.createRange()
		const lines = []
		const str = node.textContent
		for (let i = 0; i < str.length; i++) {
			range.setStart(node, i)
			range.setEnd(node, i + 1)
			const rect = range.getClientRects()[0]
			if (!rect || !rect.width) continue
			const p = toPage(rect.x, rect.y)
			let line = lines.find((l) => Math.abs(l.top - p.y) < size * 0.4)
			if (!line) lines.push((line = { top: p.y, x: p.x, h: rect.height / z, chars: '' }))
			line.chars += str[i]
		}
		for (const l of lines) out.texts.push([l.x, l.top, l.h, size, Number(s.fontWeight) >= 600 ? 1 : 0, ...rgba(s.color), l.chars])
	}
	for (const shape of document.querySelectorAll('.tl-shape[data-shape-type="arrow"]')) {
		for (const path of shape.querySelectorAll('svg path')) {
			if (path.closest('.tl-arrow-halo') || path.closest('defs')) continue
			const s = getComputedStyle(path)
			if (s.stroke === 'none' || s.display === 'none' || s.visibility === 'hidden') continue
			const len = path.getTotalLength()
			if (!len) continue
			const m = path.getScreenCTM()
			const n = Math.max(2, Math.ceil(len / 12))
			const pts = []
			for (let i = 0; i <= n; i++) {
				const q = path.getPointAtLength((len * i) / n)
				const p = toPage(...Object.values(new DOMPoint(q.x, q.y).matrixTransform(m)).slice(0, 2))
				pts.push(Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10)
			}
			out.lines.push([parseFloat(path.getAttribute('stroke-width') || s.strokeWidth), ...rgba(s.stroke), s.strokeDasharray !== 'none' ? 1 : 0, pts])
		}
	}
	out.font = getComputedStyle(document.querySelector('.lb-skillnode__name')).fontFamily
	out.camera = e.getCamera()
	return out
})
const fs = await import('fs')
fs.writeFileSync(new URL('../../prototypes/gpu-canvas/data/four-trees.json', import.meta.url), JSON.stringify(scene))
console.log('discs', scene.discs.length, 'rings', scene.rings.length, 'texts', scene.texts.length, 'lines', scene.lines.length, 'errors', errors.length)
await browser.close()
