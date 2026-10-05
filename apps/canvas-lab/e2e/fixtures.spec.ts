import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

/**
 * Phase 2 of docs/canvas-fork-plan.md: the phase 0 reference boards open in the fork without an
 * error, every shape on them is on its page, and each page is captured for comparing by eye with the
 * PNGs in `packages/canvas/fixtures/`.
 */

type Editor = {
	setCurrentPage(id: string): void
	getCurrentPageShapeIds(): Set<string>
	zoomToFit(): void
}

type StoredRecord = { id: string; typeName: string; parentId?: string }

/** The number of shapes on each page of a fixture, counted from the file itself. */
function shapesPerPage(fixture: string) {
	const path = fileURLToPath(new URL(`../../../packages/canvas/fixtures/${fixture}.json`, import.meta.url))
	const records = JSON.parse(readFileSync(path, 'utf8')).store as Record<string, StoredRecord>
	const pageOf = (record: StoredRecord): string =>
		record.parentId?.startsWith('page:') ? record.parentId : pageOf(records[record.parentId!]!)
	const counts: Record<string, number> = {}
	for (const record of Object.values(records)) {
		if (record.typeName === 'page') counts[record.id] ??= 0
		if (record.typeName === 'shape') counts[pageOf(record)] = (counts[pageOf(record)] ?? 0) + 1
	}
	return counts
}

for (const fixture of ['default-shapes', 'lifeboard']) {
	test(`${fixture} opens with every shape`, async ({ page }, testInfo) => {
		const errors: string[] = []
		page.on('pageerror', (error) => errors.push(error.message))
		page.on('console', (message) => {
			if (message.type() === 'error') errors.push(message.text())
		})

		await page.goto(`/?fixture=${fixture}`)
		await page.waitForFunction(() => 'editor' in window)

		for (const [i, [pageId, count]] of Object.entries(shapesPerPage(fixture)).entries()) {
			const shown = await page.evaluate((id) => {
				const editor = (window as unknown as { editor: Editor }).editor
				editor.setCurrentPage(id)
				editor.zoomToFit()
				return editor.getCurrentPageShapeIds().size
			}, pageId)
			expect(shown).toBe(count)
			// Let images and fonts settle before the capture.
			await page.waitForTimeout(500)
			await page.screenshot({ path: testInfo.outputPath(`${fixture}-page-${i + 1}.png`) })
		}

		expect(errors).toEqual([])
	})
}
