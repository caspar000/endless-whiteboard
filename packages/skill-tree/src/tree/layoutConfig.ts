import { atom } from '@lifeboard/canvas'
import { clean, DEFAULT_LAYOUT, type LayoutConfig } from './layoutDefaults'

export * from './layoutDefaults'

const KEY = 'lifeboard:skill-tree-layout'

function read(): LayoutConfig {
	try {
		const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<LayoutConfig>
		return clean({ ...DEFAULT_LAYOUT, ...raw })
	} catch {
		return { ...DEFAULT_LAYOUT }
	}
}

const current = atom<LayoutConfig>('lifeboard:skill-tree-layout', typeof localStorage === 'undefined' ? { ...DEFAULT_LAYOUT } : read())

/** The layout settings in use on every board of this device. */
export const getLayoutConfig = (): LayoutConfig => current.get()

export function setLayoutConfig(patch: Partial<LayoutConfig>): void {
	current.set(clean({ ...current.get(), ...patch }))
	try {
		localStorage.setItem(KEY, JSON.stringify(current.get()))
	} catch {
		// Kept for this session only.
	}
}
