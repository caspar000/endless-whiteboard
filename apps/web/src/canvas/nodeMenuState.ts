import { atom, type Atom, type Editor } from 'tldraw'

/**
 * Whether the dock's node picker is open — the searchable grid of node types (see `NodeMenu.tsx`).
 *
 * Its own module rather than state inside that component, and named apart from it because TypeScript
 * refuses two files in one directory whose names differ only in casing.
 *
 * Module-scope state for the reason `tracing.ts` explains at length: the things that open and close
 * it sit in components tldraw constructs from module-scope overrides, which the board cannot hand
 * props to. Unlike tracing, though, it is keyed **per editor** rather than global, because inactive
 * tabs keep their editors — and therefore their docks — mounted. A single global flag would open a
 * panel in every one of them, and each panel autofocuses a search box, so they would fight over the
 * caret. Keyed by editor, the key opens the picker on the board you are looking at and nowhere else.
 *
 * A `WeakMap` rather than a cleanup call: the entry dies with the editor, so a board that unmounts
 * cannot leave a stale open flag behind for the next one.
 */
const openByEditor = new WeakMap<Editor, Atom<boolean>>()

function flagFor(editor: Editor): Atom<boolean> {
	const existing = openByEditor.get(editor)
	if (existing) return existing
	const created = atom<boolean>('lifeboard:node-menu', false)
	openByEditor.set(editor, created)
	return created
}

export function isNodeMenuOpen(editor: Editor): boolean {
	return flagFor(editor).get()
}

export function setNodeMenuOpen(editor: Editor, open: boolean): void {
	flagFor(editor).set(open)
}

export function toggleNodeMenu(editor: Editor): boolean {
	const next = !isNodeMenuOpen(editor)
	setNodeMenuOpen(editor, next)
	return next
}
