/**
 * Renders the PWA icons from `public/favicon.svg`.
 *
 * Run with `pnpm gen:icons` after changing the logo. The outputs are committed, so a normal build
 * and CI never need a browser for this.
 *
 * Uses the Playwright Chromium that the e2e suite already depends on, rather than adding an image
 * library: the icons must match what the browser actually renders from the SVG, and this guarantees
 * that by construction.
 */
import { chromium } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const publicDir = join(here, '..', 'public')
const svg = readFileSync(join(publicDir, 'favicon.svg'), 'utf8')

/**
 * `maskable` icons are cropped to a circle by Android, so the artwork needs padding inside a full
 * bleed background — otherwise the corners of the logo get cut off.
 */
const TARGETS = [
	{ file: 'icon-192.png', size: 192, padding: 0 },
	{ file: 'icon-512.png', size: 512, padding: 0 },
	{ file: 'icon-512-maskable.png', size: 512, padding: 0.18 },
	{ file: 'apple-touch-icon.png', size: 180, padding: 0.08 },
]

const browser = await chromium.launch()

for (const { file, size, padding } of TARGETS) {
	const page = await browser.newPage({
		viewport: { width: size, height: size },
		deviceScaleFactor: 1,
	})
	const inset = Math.round(size * padding)
	await page.setContent(
		`<!doctype html><html><body style="margin:0;background:#101012">
		 <div style="position:absolute;inset:${inset}px">${svg.replace(
				'<svg',
				'<svg style="width:100%;height:100%;display:block"'
			)}</div>
		 </body></html>`,
		{ waitUntil: 'load' }
	)
	const png = await page.screenshot({ omitBackground: false })
	writeFileSync(join(publicDir, file), png)
	await page.close()
	console.log(`wrote public/${file} (${size}×${size})`)
}

await browser.close()
