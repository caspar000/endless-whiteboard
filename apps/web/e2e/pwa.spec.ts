import { expect, test } from '@playwright/test'
import { gotoFresh } from './helpers'

/**
 * Milestone 8's acceptance criterion: "Installed app fully works in airplane mode."
 *
 * Runs against the production build (see playwright.config.ts), because the service worker only
 * exists there — a dev-server run would pass this test for the wrong reason.
 */
test.describe('PWA', () => {
	test('serves a valid manifest with icons that actually exist', async ({ page, request }) => {
		await page.goto('/')

		const href = await page.getAttribute('link[rel="manifest"]', 'href')
		expect(href).toBeTruthy()

		const manifest = await (await request.get(href!)).json()
		expect(manifest.name).toBe('Lifeboard')
		expect(manifest.display).toBe('standalone')

		// The manifest naming icons that were never generated is a silent failure: install simply
		// offers no icon. Fetch every one.
		expect(manifest.icons.length).toBeGreaterThan(0)
		for (const icon of manifest.icons) {
			const res = await request.get(`/${icon.src.replace(/^\//, '')}`)
			expect(res.status(), `icon ${icon.src}`).toBe(200)
			expect((await res.body()).byteLength, `icon ${icon.src} is empty`).toBeGreaterThan(0)
		}
		// Android crops icons to a circle, so a maskable variant is what keeps the logo intact.
		expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true)
	})

	test('board content is fully usable with the network offline', async ({ page, context }) => {
		await gotoFresh(page)
		await expect(page.locator('.tl-canvas')).toBeVisible()

		// Wait for the service worker to take control, so the reload below is served from its cache.
		await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, undefined, {
			timeout: 30_000,
		})

		await expect(page.locator('.lb-rollup__value')).toHaveText('₾4,409')

		// Airplane mode.
		await context.setOffline(true)
		try {
			await page.reload()

			// The whole app shell comes from the cache…
			await expect(page.locator('.tl-canvas')).toBeVisible()
			// …the board's data comes from IndexedDB…
			await expect(page.locator('.lb-item').first()).toBeVisible()
			// …and the rollup still derives its total, because nothing about it needs a network.
			await expect(page.locator('.lb-rollup__value')).toHaveText('₾4,409')

			// Editing works offline too: this is a local-first app, not an online one that degrades.
			await page.evaluate(() => {
				const editor = (
					window as unknown as {
						editor: {
							getCurrentPageShapes(): { id: string; type: string; props: Record<string, unknown> }[]
							updateShape(s: unknown): void
						}
					}
				).editor
				const lamp = editor
					.getCurrentPageShapes()
					.find(
						(s) => s.type === 'node.item' && (s.props as { title?: string }).title === 'Desk lamp'
					)
				if (!lamp) throw new Error('demo lamp not found')
				editor.updateShape({
					id: lamp.id,
					type: 'node.item',
					props: {
						fields: [
							{ key: 'price', type: 'currency', value: 1120, unit: 'GEL' },
							{ key: 'category', type: 'select', value: 'lighting' },
						],
					},
				})
			})
			// 4409 - 120 + 1120 = 5409
			await expect(page.locator('.lb-rollup__value')).toHaveText('₾5,409')
		} finally {
			await context.setOffline(false)
		}
	})
})
