import { expect, test, type Page } from '@playwright/test'
import { createBoard, gotoFresh, skipFirstRunDemo } from './helpers'

/*
 * A backlog of one media type searches for it online. The first test answers for the services, so it
 * runs anywhere; the second asks the real ones for the albums and films the feature was accepted on,
 * and runs only with `LB_LIVE=1`.
 */

async function backlogCard(page: Page, x: number) {
	await page.evaluate((x) => {
		;(window as unknown as { editor: { createShapes(shapes: unknown[]): void } }).editor.createShapes([{ type: 'node.backlog', x, y: 120, props: { w: 380 } }])
	}, x)
	const card = page.locator('.lb-board-host:not([data-hidden]) .lb-backlog').last()
	await expect(card).toBeVisible()
	return card
}

async function holds(card: ReturnType<Page['locator']>, media: 'Music' | 'Film') {
	await card.getByRole('button', { name: 'Add to the backlog' }).click()
	await card.getByRole('radio', { name: media }).click()
	await expect(card.getByRole('radio', { name: media })).toHaveAttribute('aria-checked', 'true')
}

async function find(card: ReturnType<Page['locator']>, media: 'Music' | 'Film', query: string, title: string) {
	const field = card.getByRole('combobox', { name: media === 'Music' ? 'Search albums' : 'Search films' })
	await field.fill(query)
	const result = card.getByRole('option').first()
	await expect(result.locator('strong')).toHaveText(title, { timeout: 20_000 })
	await result.click()
	await expect(field).toHaveValue('')
}

const tileTitles = (card: ReturnType<Page['locator']>) => card.locator('.lb-backlog__grid .lb-backlog__title')

test('a film backlog finds a film by its Russian title, and keeps it with its poster and director', async ({ page }) => {
	await page.route('https://www.wikidata.org/**', (route) => {
		const url = route.request().url()
		const json = url.includes('list=search')
			? { query: { search: [{ title: 'Q1138968' }] } }
			: {
					entities: {
						Q1138968: {
							labels: { en: { value: 'Nostalghia' } },
							descriptions: { en: { value: '1983 film by Andrei Tarkovsky' } },
							claims: { P577: [{ mainsnak: { datavalue: { value: { time: '+1983-05-17T00:00:00Z' } } } }] },
							sitelinks: { enwiki: { site: 'enwiki', title: 'Nostalghia' } },
						},
					},
				}
		return route.fulfill({ json, headers: { 'access-control-allow-origin': '*' } })
	})
	await page.route('https://en.wikipedia.org/**', (route) =>
		route.fulfill({ json: { query: { pages: [{ title: 'Nostalghia', thumbnail: { source: 'https://upload.wikimedia.org/poster.png' } }] } }, headers: { 'access-control-allow-origin': '*' } })
	)
	// A poster drawn here, so the test needs no network at all.
	await page.route('https://upload.wikimedia.org/**', (route) =>
		route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#345"/></svg>' })
	)

	await gotoFresh(page)
	await skipFirstRunDemo(page)
	await createBoard(page)
	const card = await backlogCard(page, 200)
	await holds(card, 'Film')
	await find(card, 'Film', 'Ностальгия', 'Nostalghia')
	await expect(tileTitles(card)).toHaveText(['Nostalghia'])
	await expect(card.locator('.lb-backlog__grid .lb-backlog__creator')).toHaveText(['Andrei Tarkovsky'])
	await expect(card.locator('.lb-backlog__grid .lb-backlog__via')).toHaveText(['from Wikidata'])
	await expect(card.locator('.lb-backlog__grid img').first()).toHaveAttribute('src', 'https://upload.wikimedia.org/poster.png')
	// A film backlog's tiles are posters, taller than wide.
	const box = await card.locator('.lb-backlog__grid .lb-backlog__thumb').first().boundingBox()
	expect(box!.height).toBeGreaterThan(box!.width * 1.4)
})

test('the albums and films it was accepted on are found online', async ({ page }) => {
	test.skip(!process.env.LB_LIVE, 'Asks iTunes, MusicBrainz, Wikidata and Wikipedia: run with LB_LIVE=1')
	test.setTimeout(180_000)
	await gotoFresh(page)
	await skipFirstRunDemo(page)
	await createBoard(page)

	const music = await backlogCard(page, 120)
	await holds(music, 'Music')
	await find(music, 'Music', 'Rob Clearfield Voice in the Wilderness album', 'Voice in the Wilderness')
	await find(music, 'Music', 'Hiromi - Out There album', 'OUT THERE')
	await find(music, 'Music', 'Logic - Ultra 85 album', 'Ultra 85')
	await expect(tileTitles(music)).toHaveText(['Ultra 85', 'OUT THERE', 'Voice in the Wilderness'])
	await expect(music.locator('.lb-backlog__grid .lb-backlog__creator')).toHaveText(['Logic', 'Hiromi', 'Rob Clearfield'])

	const film = await backlogCard(page, 560)
	await holds(film, 'Film')
	await find(film, 'Film', '1974 შერეკილები', 'The Eccentrics')
	await find(film, 'Film', 'Three Billboards Outside Ebbing, Missouri', 'Three Billboards Outside Ebbing, Missouri')
	await find(film, 'Film', 'Ностальгия 1983 by tarkovsky', 'Nostalghia')
	await expect(tileTitles(film)).toHaveText(['Nostalghia', 'Three Billboards Outside Ebbing, Missouri', 'The Eccentrics'])
	await expect(film.locator('.lb-backlog__grid .lb-backlog__creator')).toHaveText(['Andrei Tarkovsky', 'Martin McDonagh', 'Eldar Shengelaya'])

	// Every cover came from the service, not drawn from the title.
	for (const card of [music, film]) {
		const covers = card.locator('.lb-backlog__grid img')
		await expect(covers).toHaveCount(3)
		for (const src of await covers.evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).src))) expect(src).toMatch(/^https:/)
		await expect.poll(() => covers.evaluateAll((imgs) => imgs.every((i) => (i as HTMLImageElement).naturalWidth > 0)), { timeout: 20_000 }).toBe(true)
	}
	await page.screenshot({ path: test.info().outputPath('acceptance.png') })
})
