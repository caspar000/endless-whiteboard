import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The feeds' only copy of your sources and categories, across a reload: what is in localStorage the
 * moment an edit is made, and what happens when the server never took it.
 */

const pushes: { key: string; value: unknown }[] = []
let serverTakes = true
vi.mock('../server/serverVault', () => ({
	pushVaultSetting: (key: string, value: unknown) => {
		pushes.push({ key, value })
		return Promise.resolve(serverTakes)
	},
}))

/** localStorage as a browser keeps it: it outlives the page, so it outlives `vi.resetModules`. */
const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
	getItem: (k: string) => storage.get(k) ?? null,
	setItem: (k: string, v: string) => void storage.set(k, v),
	removeItem: (k: string) => void storage.delete(k),
})

/** A fresh page: the extension's stores and the app's wiring, loaded again from storage. */
async function openApp() {
	vi.resetModules()
	const feeds = await import('@lifeboard/feeds')
	const app = await import('./feeds')
	app.loadFeeds()
	return { feeds, app }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const categoryNames = (feeds: typeof import('@lifeboard/feeds')) => Object.values(feeds.getCategories()).map((c) => c.name)

beforeEach(() => {
	storage.clear()
	pushes.length = 0
	serverTakes = true
})

describe('feeds across a reload', () => {
	it('keeps a category and a source made just before the page closes', async () => {
		const first = await openApp()
		const added = (first.feeds.addCategory('Electrical Engineering') as { categoryId: string }).categoryId
		first.feeds.addSource({ provider: 'youtube', feedUrl: 'https://f/1', link: '', title: 'EEVblog', categories: [added] })
		// No timers run: the page is gone at once.
		const second = await openApp()
		expect(categoryNames(second.feeds)).toEqual(['Electrical Engineering'])
		expect(Object.values(second.feeds.getSources()).map((s) => [s.title, s.categories])).toEqual([['EEVblog', [added]]])
		expect(pushes.map((p) => p.key)).toEqual(['feedCategories', 'feedSources'])
	})

	it("sends an edit the server never took again, rather than taking the server's older copy", async () => {
		serverTakes = false
		const first = await openApp()
		first.feeds.addCategory('Music')
		await settle()

		serverTakes = true
		const second = await openApp()
		second.app.applyRemoteFeeds({ feedCategories: {}, feedSources: {}, feedWatched: {} })
		expect(categoryNames(second.feeds)).toEqual(['Music'])
		expect(pushes.at(-1)).toMatchObject({ key: 'feedCategories', value: { [Object.keys(second.feeds.getCategories())[0]!]: { name: 'Music' } } })
		await settle()

		// Taken now: the next answer from the vault is the truth again.
		const third = await openApp()
		third.app.applyRemoteFeeds({ feedCategories: {}, feedSources: {}, feedWatched: {} })
		expect(categoryNames(third.feeds)).toEqual([])
	})

	it("takes the vault's copy when everything here was sent", async () => {
		const first = await openApp()
		first.feeds.addCategory('Old name')
		await settle()
		const second = await openApp()
		second.app.applyRemoteFeeds({ feedCategories: { c1: { categoryId: 'c1', name: 'From another device', color: 'blue', order: 0 } } })
		expect(categoryNames(second.feeds)).toEqual(['From another device'])
		expect(JSON.parse(storage.get('lifeboard:feedCategories')!)).toHaveProperty('c1')
	})
})
