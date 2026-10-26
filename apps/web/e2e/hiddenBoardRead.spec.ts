import { expect, test } from '@playwright/test'
import { createBoard, gotoFresh, openBoard, openBoardFromSidebar, skipFirstRunDemo } from './helpers'

/**
 * A board out of sight (behind Settings, or a tab behind the one on screen) is hidden by its host with
 * `visibility`, which every shape inherits. The GPU layer's reader must not read shapes then: each came
 * out empty, and back on screen the GPU hid their elements and drew nothing for them (PLAN-22: skill
 * nodes gone from a Mastery board after a syllabus was added in Settings).
 */

type Snapshots = { get(shape: unknown): unknown[] | null | undefined }
type Renderer = { snapshots(e: unknown): Snapshots; scene(e: unknown): { hidden: { get(): ReadonlySet<string> } } }
type Editor = { createShapes(s: unknown[]): void; getShape(id: string): unknown; getCamera(): { x: number; y: number; z: number }; setCamera(c: { x: number; y: number; z: number }): void }

const IDS = Array.from({ length: 6 }, (_, i) => `shape:hidden-read-${i}`)

test('shapes asked for while their board is hidden are read once it is shown, not as empty', async ({ page }) => {
	// The GPU layer on whatever is on screen.
	await page.addInitScript(() => localStorage.setItem('lifeboard:gpu-budget', '0'))
	await gotoFresh(page)
	await skipFirstRunDemo(page)
	await createBoard(page, 'Hidden')
	await openBoard(page, 'Hidden')

	// Skill nodes added and the board left at once: the camera nudged, so the reader is still waiting
	// for it to stop when the board goes out of sight.
	await page.evaluate((ids) => {
		const w = window as unknown as { editor: Editor; hiddenReadEditor: Editor }
		const editor = (w.hiddenReadEditor = w.editor)
		editor.createShapes(ids.map((id, i) => ({ id, type: 'node.skill', x: 100 + (i % 3) * 200, y: 100 + Math.floor(i / 3) * 200, props: { name: `Skill ${i}`, kind: 'skill' } })))
		const c = editor.getCamera()
		editor.setCamera({ ...c, x: c.x + 1 })
		location.hash = '#/settings'
	}, IDS)
	await expect(page.locator('.lb-board-host[data-hidden]')).toHaveCount(1)
	// Long enough for the reader to have read them, had it read a hidden board.
	await page.waitForTimeout(1500)

	await openBoardFromSidebar(page, 'Hidden')
	const read = () =>
		page.evaluate((ids) => {
			const w = window as unknown as { hiddenReadEditor: Editor; lifeboardRenderer: Renderer }
			const snapshots = w.lifeboardRenderer.snapshots(w.hiddenReadEditor)
			const hidden = w.lifeboardRenderer.scene(w.hiddenReadEditor).hidden.get()
			return ids.map((id) => {
				const prims = snapshots.get(w.hiddenReadEditor.getShape(id))
				return { id, pieces: prims ? prims.length : null, gpu: hidden.has(id) }
			})
		}, IDS)
	// Each read with what it draws, and the GPU drawing it.
	await expect.poll(async () => (await read()).filter((r) => r.gpu && r.pieces! > 0).length, { timeout: 15_000 }).toBe(IDS.length)
	expect((await read()).filter((r) => r.pieces === 0)).toEqual([])
})
