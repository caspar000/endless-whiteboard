import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

/**
 * Canvas appearance preferences: whether the paper has a grid, which grid, and whether it snaps.
 *
 * These are app-wide, not per-board. tldraw's own `isGridMode` is per-board *session* state, stored in
 * each board's IndexedDB, which is how one board ended up with a grid the others didn't have — you can
 * toggle it with ⌘' by accident and it sticks to that board only. Keeping the preference here means one
 * answer for every board, and App re-applies it to each editor as it mounts.
 *
 * The split into two settings is the point: tldraw conflates "draw a grid" and "snap to the grid" into
 * that single flag, so you cannot have the look without the constraint. Here they are independent —
 * `snapToGrid` drives `isGridMode` purely for its snapping, and the grid you *see* is drawn by
 * canvas/CanvasBackground.tsx instead.
 */
export type GridStyle = 'lifeboard' | 'native'

/** Corner-radius steps for frames and images. `off` is square, which is tldraw's own default. */
export const ROUNDNESS_STEPS = ['off', 'xs', 'sm', 'md', 'lg', 'xl'] as const
export type Roundness = (typeof ROUNDNESS_STEPS)[number]

export interface CanvasPrefs {
	showGrid: boolean
	gridStyle: GridStyle
	snapToGrid: boolean
	/** Corner radius for frames and images, app-wide. */
	roundness: Roundness
	setShowGrid: (value: boolean) => void
	setGridStyle: (value: GridStyle) => void
	setSnapToGrid: (value: boolean) => void
	setRoundness: (value: Roundness) => void
}

const GRID_KEY = 'lifeboard:showGrid'
const GRID_STYLE_KEY = 'lifeboard:gridStyle'
const SNAP_KEY = 'lifeboard:snapToGrid'
const ROUNDNESS_KEY = 'lifeboard:roundness'

function loadFlag(key: string, fallback: boolean): boolean {
	try {
		const raw = localStorage.getItem(key)
		return raw === null ? fallback : raw === 'true'
	} catch {
		return fallback
	}
}

function loadGridStyle(): GridStyle {
	try {
		return localStorage.getItem(GRID_STYLE_KEY) === 'native' ? 'native' : 'lifeboard'
	} catch {
		return 'lifeboard'
	}
}

function loadRoundness(): Roundness {
	try {
		const raw = localStorage.getItem(ROUNDNESS_KEY)
		return ROUNDNESS_STEPS.includes(raw as Roundness) ? (raw as Roundness) : 'sm'
	} catch {
		return 'sm'
	}
}

function save(key: string, value: string): void {
	try {
		localStorage.setItem(key, value)
	} catch {
		// Private-mode Safari can throw on write; losing the preference across reloads is fine.
	}
}

/** Owns the state. Called once, by App, which both uses the values and provides them below. */
export function useCanvasPrefsState(): CanvasPrefs {
	// A grid is the default look — the paper has always had one. Snapping is not: it constrains where
	// things can go, which is a working preference rather than a visual one.
	const [showGrid, setShowGridState] = useState(() => loadFlag(GRID_KEY, true))
	const [gridStyle, setGridStyleState] = useState<GridStyle>(loadGridStyle)
	const [snapToGrid, setSnapToGridState] = useState(() => loadFlag(SNAP_KEY, false))
	// `sm` rather than `off`: a slight radius is the look this was added for, and it is cosmetic enough
	// to be the default without surprising anyone.
	const [roundness, setRoundnessState] = useState<Roundness>(loadRoundness)

	/*
	 * Applied as an attribute on `<html>` and resolved to a length in CSS, the same way the theme is.
	 *
	 * Not a prop threaded to the shapes: the radius belongs to tldraw's own elements — the frame's
	 * `<rect>` and the image's container — which we do not render. A CSS custom property reaches both
	 * without touching either component.
	 */
	useEffect(() => {
		document.documentElement.dataset.roundness = roundness
	}, [roundness])

	const setShowGrid = useCallback((value: boolean) => {
		setShowGridState(value)
		save(GRID_KEY, String(value))
	}, [])
	const setGridStyle = useCallback((value: GridStyle) => {
		setGridStyleState(value)
		save(GRID_STYLE_KEY, value)
	}, [])
	const setSnapToGrid = useCallback((value: boolean) => {
		setSnapToGridState(value)
		save(SNAP_KEY, String(value))
	}, [])
	const setRoundness = useCallback((value: Roundness) => {
		setRoundnessState(value)
		save(ROUNDNESS_KEY, value)
	}, [])

	return useMemo(
		() => ({
			showGrid,
			gridStyle,
			snapToGrid,
			roundness,
			setShowGrid,
			setGridStyle,
			setSnapToGrid,
			setRoundness,
		}),
		[
			showGrid,
			gridStyle,
			snapToGrid,
			roundness,
			setShowGrid,
			setGridStyle,
			setSnapToGrid,
			setRoundness,
		]
	)
}

const CanvasPrefsContext = createContext<CanvasPrefs | null>(null)

export const CanvasPrefsProvider = CanvasPrefsContext.Provider

/**
 * Read by the canvas background, which renders *inside* `<Tldraw>`. Context rather than props because
 * the component is handed to tldraw through its `components` map, which must keep a stable identity —
 * rebuilding that map on every preference change would remount the background.
 */
export function useCanvasPrefs(): CanvasPrefs {
	const prefs = useContext(CanvasPrefsContext)
	if (!prefs) throw new Error('useCanvasPrefs must be used inside a CanvasPrefsProvider')
	return prefs
}
