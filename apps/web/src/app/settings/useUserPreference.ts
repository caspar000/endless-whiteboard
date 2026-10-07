import { getUserPreferences, setUserPreferences, useValue, type TLUserPreferences } from '@lifeboard/canvas'
import { useCallback } from 'react'

/**
 * One of the canvas's own preferences, read and written from the settings page. They are app-wide
 * already (one stored copy every board reads), so there is nothing to apply per editor. The write
 * merges into the live value, so the rest of the preferences stay as they are.
 */
export function useUserPreference<K extends Exclude<keyof TLUserPreferences, 'id'>>(key: K) {
	const value = useValue(`user preference ${key}`, () => getUserPreferences()[key], [key])
	const set = useCallback(
		(next: TLUserPreferences[K]) => setUserPreferences({ ...getUserPreferences(), [key]: next }),
		[key]
	)
	return [value, set] as const
}
