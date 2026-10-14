import { atom } from '@lifeboard/canvas'
import { parseStoredLayout, type PropertyLayout } from './layout'

/**
 * Saved card layouts, and the layout clipboard (docs/property-display-plan.md).
 *
 * The library follows the vault: the app persists it (localStorage, and the server vault when there is
 * one) through the listener it installs here. Saving snapshots a layout and applying copies it, so a
 * node never refers to a library entry and editing one card never changes another.
 *
 * Layouts refer to properties by id, and ids come from names, so a layout saved on one board works on
 * any board whose properties have the same names. One that doesn't exist on a board just stays empty.
 */

export interface SavedLayout {
	name: string
	layout: PropertyLayout
}

const library = atom<readonly SavedLayout[]>('lifeboard:layout-library', [])
let persist: ((list: readonly SavedLayout[]) => void) | null = null

export function getLayoutLibrary(): readonly SavedLayout[] {
	return library.get()
}

/** The app's hook for saving the library wherever it keeps vault settings. */
export function setLayoutLibraryPersistence(listener: ((list: readonly SavedLayout[]) => void) | null): void {
	persist = listener
}

/** Takes a stored or synced list as the truth. Malformed entries are dropped one by one. Doesn't persist. */
export function replaceLayoutLibrary(raw: unknown): void {
	if (!Array.isArray(raw)) return
	const next = raw.flatMap((entry): SavedLayout[] => {
		if (!entry || typeof entry !== 'object') return []
		const { name, layout } = entry as { name?: unknown; layout?: unknown }
		const parsed = parseStoredLayout(layout)
		return typeof name === 'string' && name.trim() && parsed ? [{ name: name.trim(), layout: parsed }] : []
	})
	if (JSON.stringify(next) !== JSON.stringify(library.get())) library.set(next)
}

/** Saves under a name, replacing a layout already saved under it (ignoring case). */
export function saveLayoutToLibrary(name: string, layout: PropertyLayout): void {
	const trimmed = name.trim()
	if (!trimmed) return
	const key = trimmed.toLowerCase()
	const entry = { name: trimmed, layout: JSON.parse(JSON.stringify(layout)) as PropertyLayout }
	const current = library.get()
	const index = current.findIndex((saved) => saved.name.toLowerCase() === key)
	const next = index === -1 ? [...current, entry] : current.map((saved, i) => (i === index ? entry : saved))
	library.set(next)
	persist?.(next)
}

export function removeLayoutFromLibrary(name: string): void {
	const next = library.get().filter((saved) => saved.name !== name)
	library.set(next)
	persist?.(next)
}

/**
 * The layout clipboard: `undefined` until something is copied, `null` when what was copied is the
 * automatic layout (pasting that removes a card's own layout).
 */
const copied = atom<PropertyLayout | null | undefined>('lifeboard:layout-clipboard', undefined)

export function copyLayout(layout: PropertyLayout | null): void {
	copied.set(layout)
}

export function getCopiedLayout(): PropertyLayout | null | undefined {
	return copied.get()
}
