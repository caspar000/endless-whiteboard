import { expect, test } from '@playwright/test'
import { backToList, createBoard, gotoFresh, openSettings, skipFirstRunDemo } from './helpers'

/**
 * Pasting a link.
 *
 * These run against the **production build** like the rest of the suite, which is the point of two
 * of them: `/__lifeboard/unfurl` is mounted on the preview server as well as the dev server, so
 * "link previews work in a build, with no dev server anywhere" is a thing this suite actually
 * checks rather than a claim in a comment.
 *
 * Nothing here reaches the real web. A page that cannot be read is the case worth pinning down —
 * it is where the original bug lived, and where a regression would be silent — so the URL is a
 * `.invalid` host, which by RFC 2606 never resolves.
 */
const DEAD_LINK = 'https://never-resolves-91723.invalid/some/page'
const DEAD_HOST = 'never-resolves-91723.invalid'

async function pasteText(page: import('@playwright/test').Page, text: string): Promise<void> {
	await page.evaluate((value) => {
		const data = new DataTransfer()
		data.setData('text/plain', value)
		document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }))
	}, text)
}

test.describe('link previews', () => {
	test('the unfurl endpoint is served by the production build', async ({ request, baseURL }) => {
		// 400 rather than 404 is the assertion: something answered, and it was ours.
		const noUrl = await request.get(`${baseURL}/__lifeboard/unfurl`)
		expect(noUrl.status()).toBe(400)

		// The SSRF guard, which matters most in exactly the deployment this build is for: an endpoint
		// that fetches a URL anyone can choose must not be a way to read the server's own network.
		const privateHost = await request.get(
			`${baseURL}/__lifeboard/unfurl?url=${encodeURIComponent('http://169.254.169.254/latest/meta-data/')}`
		)
		expect(privateHost.status()).toBe(502)
	})

	test('a page that cannot be read leaves a tidy card, not a broken image', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)

		// Notes claim a pasted link first; switching them off is what routes it to the bookmark card,
		// which is the surface this test is about.
		await openSettings(page, 'Extensions')
		await page.getByRole('checkbox', { name: 'Enable Markdown notes' }).uncheck()
		await backToList(page)
		await createBoard(page)

		await pasteText(page, DEAD_LINK)

		const card = page.locator('.tl-bookmark__container')
		await expect(card).toBeVisible()
		// The regression, stated directly: tldraw's default handler resolved an *absent* `og:image`
		// against the page and set the HTML document as the card's `<img src>`. No image element at
		// all is the correct rendering of "this page told us nothing".
		await expect(page.locator('.tl-bookmark__image')).toHaveCount(0)
		await expect(page.locator('.tl-bookmark__image_container')).toHaveCount(0)
		// The host, in place of the raw URL that used to be printed here in heading type.
		await expect(page.locator('.tl-bookmark__heading')).toHaveText(DEAD_HOST)

		// tldraw sizes a bookmark from its asset, so an honest asset is also a short card rather than
		// a full-height one with an empty frame in it.
		const height = await page.evaluate(
			() =>
				(
					window as unknown as {
						editor: { getCurrentPageShapes(): { type: string; props: { h: number } }[] }
					}
				).editor
					.getCurrentPageShapes()
					.find((shape) => shape.type === 'bookmark')?.props.h
		)
		expect(height).toBeLessThan(200)
	})

	test('a note keeps its host title when the page cannot be read', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await pasteText(page, DEAD_LINK)

		const note = page.locator('.tl-shape[data-shape-type="node.markdown"]')
		await expect(note).toBeVisible()
		// Written immediately and left alone: the late title only ever *replaces* the host, and a
		// lookup that answers nothing must not blank it or write the raw URL in its place.
		await expect(note.getByRole('link', { name: DEAD_HOST })).toBeVisible()
		await page.waitForTimeout(1_000)
		await expect(note.getByRole('link', { name: DEAD_HOST })).toBeVisible()
	})
})
