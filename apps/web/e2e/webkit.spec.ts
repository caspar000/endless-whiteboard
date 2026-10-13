import { expect, test } from '@playwright/test'

/**
 * Safari (WebKit), on an iPhone. Run by the `webkit` project only (playwright.config.ts).
 *
 * WebKit refuses to keep a Blob in IndexedDB in some sessions, and every picture on an iPhone went
 * missing with it: storing the image threw before it could be shown (platform/WebPlatformAdapter.ts).
 */
test('a picture shows, and is still there after a reload', async ({ page }) => {
	// A fresh context starts empty, so no wiping is needed; the first run's demo board opens.
	await page.goto('/')
	await expect(page.locator('.lb-board-host:not([data-hidden]) .tl-canvas')).toBeVisible()
	await page.waitForFunction(() => Boolean((window as unknown as { editor?: unknown }).editor))

	await page.evaluate(async () => {
		const canvas = document.createElement('canvas')
		canvas.width = 120
		canvas.height = 80
		const ctx = canvas.getContext('2d')!
		ctx.fillStyle = '#3a7'
		ctx.fillRect(0, 0, 120, 80)
		const blob: Blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'))
		const editor = (window as unknown as { editor: { putExternalContent(input: unknown): Promise<void> } }).editor
		await editor.putExternalContent({ type: 'files', files: [new File([blob], 'green.png', { type: 'image/png' })], point: { x: 200, y: 300 } })
	})

	const drawn = page.locator('.lb-board-host:not([data-hidden]) img.tl-image')
	await expect(drawn).toHaveCount(1)
	await expect.poll(() => drawn.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)

	await page.reload()
	await expect(drawn).toHaveCount(1, { timeout: 20_000 })
	await expect.poll(() => drawn.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
})
