import { expect, test, type Page } from '@playwright/test'
import { countShapes, createBoard, gotoFresh, skipFirstRunDemo } from './helpers'

/**
 * SVG arriving by drop or paste is cleaned before it is drawn or stored (docs/fork-parity.md X1):
 * these pictures would each open an alert if anything in them ran.
 */
const HOSTILE = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" onload="alert('onload')">
	<script>alert('script')</script>
	<rect width="120" height="80" fill="#4465e9"/>
	<image href="nothing-here.png" onerror="alert('onerror')"/>
	<a href="javascript:alert('link')"><circle cx="40" cy="40" r="20"/></a>
</svg>`

/** The text of every SVG in this browser's blob store. */
async function storedSvgs(page: Page): Promise<string[]> {
	return page.evaluate(async () => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const req = indexedDB.open('lifeboard')
			req.onsuccess = () => resolve(req.result)
			req.onerror = () => reject(req.error)
		})
		if (!db.objectStoreNames.contains('blobs')) return []
		const all = await new Promise<unknown[]>((resolve) => {
			const q = db.transaction('blobs', 'readonly').objectStore('blobs').getAll()
			q.onsuccess = () => resolve(q.result)
		})
		db.close()
		const svgs = all.filter((b): b is Blob => b instanceof Blob && b.type === 'image/svg+xml')
		return Promise.all(svgs.map((b) => b.text()))
	})
}

test.describe('SVG from outside (X1)', () => {
	test('a dropped SVG file and pasted SVG text arrive as pictures, with nothing in them running', async ({
		page,
	}) => {
		const alerts: string[] = []
		page.on('dialog', (dialog) => {
			alerts.push(dialog.message())
			void dialog.dismiss()
		})

		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		// Dropped, the way a browser drops a file from the desktop.
		await page.evaluate((text) => {
			const data = new DataTransfer()
			data.items.add(new File([text], 'hostile.svg', { type: 'image/svg+xml' }))
			const canvas = document.querySelector('.lb-board-host:not([data-hidden]) .tl-canvas')!
			const at = canvas.getBoundingClientRect()
			const init = { dataTransfer: data, bubbles: true, cancelable: true, clientX: at.left + 200, clientY: at.top + 200 }
			canvas.dispatchEvent(new DragEvent('dragenter', init))
			canvas.dispatchEvent(new DragEvent('dragover', init))
			canvas.dispatchEvent(new DragEvent('drop', init))
		}, HOSTILE)
		await expect.poll(() => countShapes(page, 'image')).toBe(1)

		// Pasted as text, which is measured in the page before it becomes a picture.
		await page.evaluate(
			(text) =>
				(
					window as unknown as { editor: { putExternalContent(c: unknown): Promise<void> } }
				).editor.putExternalContent({ type: 'svg-text', text, point: { x: 600, y: 200 } }),
			HOSTILE.replace('#4465e9', '#099268')
		)
		await expect.poll(() => countShapes(page, 'image')).toBe(2)

		await expect.poll(async () => (await storedSvgs(page)).length).toBe(2)
		for (const stored of await storedSvgs(page)) {
			expect(stored).toContain('<rect')
			expect(stored).not.toMatch(/alert|<script|onload|onerror|javascript:/i)
		}
		// Long enough for an image error or a load handler to have fired, had either survived.
		await page.waitForTimeout(500)
		expect(alerts).toEqual([])
	})
})
