import { atom } from '@lifeboard/canvas'
import { keyedStore } from '@lifeboard/node-kit'
import { vaultCache, type VaultStore } from '../app/vaultCache'
import {
	defaultSetup,
	editBase,
	newWeek,
	readPage,
	readSetup,
	readWeek,
	today,
	type DailySetup,
	type Day,
	type DayPage,
	type WeekPlan,
	type Widget,
} from './model'

/**
 * The daily page's data, kept in the vault as rankings and backlogs are (`app/vaultCache.ts`): the
 * only copy there is, saved the moment it changes and sent to the server for every device.
 *
 * The setup is one record. A vault that has none yet shows `defaultSetup`, and keeps it from the first
 * change on.
 */

const storedSetup = atom<DailySetup | null>('lifeboard:daily-setup', null)
/** What a vault with no setup of its own shows, made once so its ids and its first day stay put. */
let fallback: DailySetup | null = null
let persistSetup: ((value: unknown) => void) | null = null

export function getSetup(): DailySetup {
	return storedSetup.get() ?? (fallback ??= defaultSetup(today()))
}

export function setSetup(next: DailySetup): void {
	if (JSON.stringify(next) === JSON.stringify(storedSetup.get())) return
	storedSetup.set(next)
	persistSetup?.(next)
}

export function updateSetup(change: (setup: DailySetup) => DailySetup): void {
	setSetup(change(getSetup()))
}

/**
 * A day's layout as it is being edited, not saved until it is said whether the change is that page's
 * alone or the days' after it too. Kept here rather than in the screen, so leaving the daily page and
 * coming back doesn't lose it; never stored, so a reload does.
 */
export interface LayoutDraft {
	day: Day
	/** The layout the day had when the editing began: what "all future pages" takes the changes from. */
	base: Widget[]
	widgets: Widget[]
}

export const layoutDraft = atom<LayoutDraft | null>('lifeboard:daily-layout-draft', null)

export const dailyPages = keyedStore<DayPage>('lifeboard:daily-pages', readPage, (p) => p.date)
export const dailyWeeks = keyedStore<WeekPlan>('lifeboard:daily-weeks', readWeek, (w) => w.week)

/**
 * Changes a day's page: the stored one as it is now, with what the page shows and hasn't stored yet
 * (`shown`: lists carried from an earlier day) put in first (`editBase`).
 */
export function updatePage(date: Day, change: (page: DayPage) => DayPage, shown?: DayPage): void {
	dailyPages.put(date, change(editBase(dailyPages.one(date), shown, date)))
}

export function updateWeek(week: Day, change: (plan: WeekPlan) => WeekPlan): void {
	dailyWeeks.put(week, change(dailyWeeks.one(week) ?? newWeek(week)))
}

const VAULT = vaultCache('daily', [
	{
		key: 'dailySetup',
		cacheKey: 'lifeboard:dailySetup',
		get: () => storedSetup.get(),
		replace: (raw: unknown) => storedSetup.set(readSetup(raw)),
		listen: (listener: ((value: unknown) => void) | null) => {
			persistSetup = listener
		},
	},
	{ key: 'dailyPages', cacheKey: 'lifeboard:dailyPages', get: dailyPages.get, replace: dailyPages.replace, listen: dailyPages.setPersistence },
	{ key: 'dailyWeeks', cacheKey: 'lifeboard:dailyWeeks', get: dailyWeeks.get, replace: dailyWeeks.replace, listen: dailyWeeks.setPersistence },
] as VaultStore[])

export const loadDaily = VAULT.load
/** On logging out, and when another vault answers than the one the cache is of. */
export const forgetDaily = VAULT.forget
export const applyRemoteDaily = VAULT.applyRemote

/** Read reactively: what `useValue` follows. */
export const setupAtom = storedSetup
