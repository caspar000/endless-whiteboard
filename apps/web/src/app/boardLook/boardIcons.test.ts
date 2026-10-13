import { beforeAll, describe, expect, it } from 'vitest'
import { boardGradient, boardTint, hslToHex } from '../boardTint'
import { SEARCH_LIMIT, SUGGESTED, iconName, loadBoardIcons, searchBoardIcons, type IconCatalogue } from './boardIcons'

let catalogue: IconCatalogue
beforeAll(async () => {
	catalogue = await loadBoardIcons()
})

const names = (query: string) => searchBoardIcons(catalogue, query).icons.map((icon) => icon.name)

describe('board icons', () => {
	it('has Tabler but its crossed-out variants, each name once, in categories', () => {
		expect(catalogue.icons.length).toBeGreaterThan(4500)
		expect(catalogue.icons.some((icon) => icon.name.endsWith('-off'))).toBe(false)
		expect(catalogue.byName.size).toBe(catalogue.icons.length)
		expect(catalogue.categories.slice(0, 3)).toEqual(['Sport', 'Health', 'Vehicles'])
	})

	it('finds things by what they are and what they are for', () => {
		expect(names('car engine')[0]).toBe('engine')
		expect(names('dumbbell')[0]).toBe('dumbbell')
		expect(names('gym')).toContain('barbell')
		expect(names('guitar')[0]).toBe('guitar-pick')
	})

	it('puts the icon whose name it is first, and needs every word', () => {
		expect(names('car')[0]).toBe('car')
		expect(names('dumbbell pizza')).toEqual([])
	})

	it('draws at most a page of results, and says how many there were', () => {
		const { icons, total } = searchBoardIcons(catalogue, 'a')
		expect(icons.length).toBe(SEARCH_LIMIT)
		expect(total).toBeGreaterThan(SEARCH_LIMIT)
		expect(searchBoardIcons(catalogue, '  ').icons).toEqual([])
	})

	it('suggests only icons it has', () => {
		for (const [, entries] of SUGGESTED) for (const [name] of entries) expect(catalogue.byName.has(name), name).toBe(true)
	})

	it('still shows the icons boards stored when they were Lucide’s', () => {
		expect(iconName('gamepad-2')).toBe('device-gamepad-2')
		expect(iconName('dumbbell')).toBe('dumbbell')
		for (const old of ['house', 'sprout', 'lightbulb']) expect(catalogue.byName.has(iconName(old)!), old).toBe(true)
		expect(iconName(undefined)).toBeUndefined()
	})
})

describe('board colours', () => {
	it('draws a chosen colour the way the default is drawn', () => {
		// The default for some id, and a colour at the same hue and softness, give the same gradient.
		const hue = Number(/hsl\((\d+)/.exec(boardTint('some-board'))![1])
		const same = boardGradient(hslToHex(hue, 75, 84))
		const [a, b] = [boardTint('some-board'), same].map((g) => g.match(/hsl\([^)]*\)/g)!)
		// Rounding through #rrggbb moves a value by a point at most.
		for (const [x, y] of a!.map((stop, i) => [stop, b![i]!])) {
			const nx = x!.match(/\d+/g)!.map(Number)
			const ny = y!.match(/\d+/g)!.map(Number)
			nx.forEach((n, i) => expect(Math.abs(n - ny[i]!)).toBeLessThanOrEqual(1))
		}
	})

	it('turns a hue into #rrggbb', () => {
		expect(hslToHex(0, 100, 50)).toBe('#ff0000')
		expect(hslToHex(120, 100, 25)).toBe('#008000')
		expect(hslToHex(0, 0, 100)).toBe('#ffffff')
	})
})
