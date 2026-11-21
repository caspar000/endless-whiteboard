import { atom } from '@lifeboard/canvas'
import { DEFAULT_TIERS, MAX_TIERS, clampWeight, type Tier } from './model'

/**
 * Ranking Tiers' own settings, this device's (Settings → Extensions → Ranking Tiers): how odds are
 * written, and the tiers a new ranking starts with.
 */
export interface RankingPrefs {
	/** Odds as "20%" rather than "1 in 5". */
	percent: boolean
	/** What a new card starts with, top first. */
	tiers: ReadonlyArray<Pick<Tier, 'name' | 'weight'>>
}

const KEY = 'lifeboard:ranking-tiers:prefs'
const DEFAULTS: RankingPrefs = { percent: false, tiers: DEFAULT_TIERS }

function read(): RankingPrefs {
	try {
		const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null')
		if (!raw || typeof raw !== 'object') return DEFAULTS
		const { percent, tiers } = raw as Record<string, unknown>
		const list = Array.isArray(tiers)
			? tiers
					.filter((t): t is Record<string, unknown> => !!t && typeof t === 'object' && typeof (t as { name?: unknown }).name === 'string')
					.map((t) => ({ name: String(t.name).trim(), weight: clampWeight(Number(t.weight)) }))
					.filter((t) => t.name)
					.slice(0, MAX_TIERS)
			: []
		return { percent: percent === true, tiers: list.length ? list : DEFAULT_TIERS }
	} catch {
		// No DOM (tests), or a malformed copy: the defaults.
		return DEFAULTS
	}
}

const prefs = atom<RankingPrefs>('lifeboard:ranking-prefs', read())

export function getPrefs(): RankingPrefs {
	return prefs.get()
}

export function setPrefs(change: Partial<RankingPrefs>): void {
	const next = { ...prefs.get(), ...change }
	prefs.set(next)
	try {
		localStorage.setItem(KEY, JSON.stringify(next))
	} catch {
		// Private-mode Safari can throw on write; the setting lasts until the tab closes.
	}
}

/** Tiers as Settings' text box writes them: one per line, `Name × weight`, the weight left out for 1. */
export function formatTiers(tiers: RankingPrefs['tiers']): string {
	return tiers.map((t) => (t.weight === 1 ? t.name : `${t.name} × ${t.weight}`)).join('\n')
}

export function parseTiers(text: string): Array<Pick<Tier, 'name' | 'weight'>> {
	return text
		.split('\n')
		.map((line) => {
			const m = /^(.*?)\s*[×x*]\s*(\d+)\s*$/.exec(line.trim())
			return m ? { name: m[1]!.trim(), weight: clampWeight(Number(m[2])) } : { name: line.trim(), weight: 1 }
		})
		.filter((t) => t.name)
		.slice(0, MAX_TIERS)
}
