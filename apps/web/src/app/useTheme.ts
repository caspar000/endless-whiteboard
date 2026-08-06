import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The app's colour theme.
 *
 * Three values are stored but only two are ever *applied*: `system` is resolved against the OS here,
 * and `<html data-theme>` always carries a concrete `light` or `dark`. That is what keeps styles.css to
 * two token blocks with no `prefers-color-scheme` query in it.
 *
 * Stored in `localStorage`, not the KV store, because it has to be readable *synchronously*: the KV
 * store is async, so the theme would land a frame after first paint and every light-mode load would
 * flash dark. index.html re-does this same resolution inline for the same reason — the tiny snippet
 * there is the pre-React half of this hook, and the key below is the contract between them.
 *
 * This hook covers the app's own chrome only. Telling the canvas is `App`'s job, because that is what
 * holds the live editors — see `editor.setColorMode` there.
 */
export type Theme = 'light' | 'dark' | 'system'

export const THEME_KEY = 'lifeboard:theme'

function loadTheme(): Theme {
	try {
		const raw = localStorage.getItem(THEME_KEY)
		return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system'
	} catch {
		return 'system'
	}
}

const DARK_QUERY = '(prefers-color-scheme: dark)'

function resolve(theme: Theme): 'light' | 'dark' {
	if (theme !== 'system') return theme
	return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

/**
 * The `theme-color` meta tag, which is what mobile browser chrome paints itself with. Read from the
 * live `--lb-bg` rather than duplicated here, so it can never drift from the palette.
 */
function syncBrowserChrome(): void {
	const meta = document.querySelector('meta[name="theme-color"]')
	if (!(meta instanceof HTMLMetaElement)) return
	const bg = getComputedStyle(document.documentElement).getPropertyValue('--lb-bg').trim()
	if (bg) meta.content = bg
}

export function useTheme({
	onRepaint,
}: {
	/**
	 * Called after the app has actually changed appearance, so thumbnails baked in the old theme can be
	 * refreshed. Not called on the first run, nor when only the stored preference moves (picking `dark`
	 * while a `system` that already resolved to dark was showing).
	 */
	onRepaint?: () => void
} = {}) {
	const [theme, setTheme] = useState<Theme>(loadTheme)

	/**
	 * The last theme actually painted, so `onRepaint` fires on a change of the *resolved* value rather
	 * than of the preference.
	 *
	 * Seeded from the DOM, which index.html has already set — otherwise the first effect run would
	 * always look like a change.
	 */
	const applied = useRef(document.documentElement.dataset.theme ?? null)

	// Held in a ref so a caller passing an inline function can't re-run the effect (which would
	// re-apply the theme, and on a stable theme that is just churn).
	const repaint = useRef(onRepaint)
	repaint.current = onRepaint

	useEffect(() => {
		const apply = () => {
			const resolved = resolve(theme)
			document.documentElement.dataset.theme = resolved
			syncBrowserChrome()

			const changed = applied.current !== null && applied.current !== resolved
			applied.current = resolved
			if (changed) repaint.current?.()
		}

		apply()

		// Only `system` cares about the OS flipping under it.
		if (theme !== 'system') return
		const query = window.matchMedia(DARK_QUERY)
		query.addEventListener('change', apply)
		return () => query.removeEventListener('change', apply)
	}, [theme])

	const changeTheme = useCallback((next: Theme) => {
		setTheme(next)
		try {
			localStorage.setItem(THEME_KEY, next)
		} catch {
			// Private-mode Safari can throw on write; losing the preference across reloads is fine.
		}
	}, [])

	return { theme, setTheme: changeTheme }
}
