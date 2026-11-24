import { beforeAll, describe, expect, it } from 'vitest'
import { defaultSetup } from '../../daily/model'
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
		expect(catalogue.categories.slice(0, 4)).toEqual(['Activities', 'Everyday', 'Sport', 'Health'])
	})

	it('has the packs, their icons named after the pack and drawn with fills that take no stroke', () => {
		expect(catalogue.packs.map((pack) => pack.id)).toEqual(['activities', 'everyday'])
		for (const pack of catalogue.packs) {
			const icons = pack.groups.flatMap(([, entries]) => entries)
			expect(icons.length).toBeGreaterThan(50)
			for (const icon of icons) {
				expect(icon.name.startsWith(`${pack.id}:`), icon.name).toBe(true)
				expect(icon.category).toBe(pack.name)
				expect(icon.paths.length, icon.name).toBeGreaterThan(0)
				for (const path of icon.paths) {
					if (typeof path !== 'string' && path[1].fill && path[1].fill !== 'none') expect(path[1].stroke, icon.name).toBe('none')
				}
			}
		}
		expect(catalogue.byName.get('activities:swimming')?.label).toBe('swimming')
	})

	it('finds a pack’s icon first, by its name or what it is for', () => {
		expect(names('swimming')[0]).toBe('activities:swimming')
		expect(names('brush teeth')[0]).toBe('everyday:toothbrush')
		expect(names('kendo')[0]).toBe('activities:kendo')
		expect(names('laundry')).toContain('everyday:laundry')
	})

	it('has every icon the daily page starts with', () => {
		for (const task of defaultSetup('2026-11-01').iconTasks) expect(catalogue.byName.has(iconName(task.icon)!), task.icon).toBe(true)
	})

	it('finds things by what they are and what they are for', () => {
		expect(names('car engine')[0]).toBe('engine')
		expect(names('dumbbell')[0]).toBe('dumbbell')
		expect(names('gym')).toContain('barbell')
		// Tabler has only a pick; the Everyday pack draws the guitar.
		expect(names('guitar').slice(0, 2)).toEqual(['everyday:guitar', 'guitar-pick'])
	})

	it('puts the icon whose name it is first, and needs every word', () => {
		// The pack's car, then Tabler's: a pack's icon first between two as close.
		expect(names('car').slice(0, 2)).toEqual(['everyday:car', 'car'])
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
