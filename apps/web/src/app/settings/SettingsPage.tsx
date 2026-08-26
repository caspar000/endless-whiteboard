import { useEffect, useRef } from 'react'
import type { CanvasPrefs } from '../canvasPrefs'
import type { BoardsApi } from '../useBoards'
import type { Theme } from '../useTheme'
import { AgentsPanel } from './AgentsPanel'
import { AppearancePanel } from './AppearancePanel'
import { CanvasPanel } from './CanvasPanel'
import { ExtensionDetail } from './ExtensionDetail'
import { ExtensionsPanel } from './ExtensionsPanel'
import { GeneralPanel } from './GeneralPanel'
import { KeymapPanel } from './KeymapPanel'
import { StoragePanel } from './StoragePanel'
import { EXTENSIONS_TAB, SETTINGS_GROUPS, SETTINGS_TABS, tabFor } from './sections'

/**
 * The settings page: a rail of tabs on the left, one tab at a time on the right — the help page's
 * layout, for the same reason it has one, and Obsidian's for anyone who arrives already knowing it.
 *
 * The selected tab lives in the route (see `useHashRoute`), not in state here, so a tab is a link and
 * the back button works between them — including back out of an extension's own page.
 */
export function SettingsPage({
	tab,
	extensionId,
	onTab,
	onExtension,
	theme,
	onThemeChange,
	canvas,
	api,
	onImported,
}: {
	tab: string | undefined
	extensionId: string | undefined
	onTab: (tab: string) => void
	/** `null` closes an extension's page and returns to the list. */
	onExtension: (id: string | null) => void
	theme: Theme
	onThemeChange: (theme: Theme) => void
	canvas: CanvasPrefs
	api: BoardsApi
	onImported?: () => void
}) {
	const active = tabFor(tab)
	// An extension page only makes sense under its own tab; an id on any other one is a stale link.
	const openExtensionId = active.id === EXTENSIONS_TAB ? extensionId : undefined

	/**
	 * A new tab starts at its top.
	 *
	 * Only this pane scrolls, so without it opening Storage from the foot of the extensions list would
	 * show Storage halfway down — which reads as a page that failed to load its heading.
	 */
	const main = useRef<HTMLElement>(null)
	useEffect(() => {
		main.current?.scrollTo({ top: 0 })
	}, [active.id, openExtensionId])

	return (
		<div className="lb-pane">
			<nav className="lb-rail" aria-label="Settings sections">
				{SETTINGS_GROUPS.map((group) => {
					const inGroup = SETTINGS_TABS.filter((t) => t.group === group)
					if (!inGroup.length) return null
					return (
						<div className="lb-rail__group" key={group}>
							<div className="lb-rail__title">{group}</div>
							{inGroup.map((t) => (
								<button
									key={t.id}
									className={
										t.id === active.id ? 'lb-rail__item lb-rail__item--active' : 'lb-rail__item'
									}
									aria-current={t.id === active.id ? 'page' : undefined}
									onClick={() => onTab(t.id)}
								>
									<span className="lb-rail__icon" aria-hidden="true">
										{t.icon}
									</span>
									<span>{t.label}</span>
								</button>
							))}
						</div>
					)
				})}
			</nav>

			<main className="lb-pane__main" ref={main}>
				<div className="lb-settings-page">
					{openExtensionId ? (
						// Keyed so switching extensions remounts the page rather than swapping its text under
						// a scroll position that belonged to the last one.
						<ExtensionDetail
							key={openExtensionId}
							id={openExtensionId}
							onBack={() => onExtension(null)}
						/>
					) : (
						<>
							<header className="lb-home__header">
								<h1>{active.label}</h1>
							</header>
							{/* Matched on here rather than carried as a `Component` on the tab, because these
							    panels take genuinely different things — a theme, a boards API, a navigate — and
							    a single props bundle wide enough for all of them would hand every panel
							    capability it has no business having. */}
							{active.id === 'general' && <GeneralPanel />}
							{active.id === 'appearance' && (
								<AppearancePanel theme={theme} onThemeChange={onThemeChange} canvas={canvas} />
							)}
							{active.id === 'canvas' && <CanvasPanel canvas={canvas} />}
							{active.id === 'keyboard' && <KeymapPanel />}
							{active.id === 'storage' && <StoragePanel api={api} onImported={onImported} />}
							{active.id === EXTENSIONS_TAB && <ExtensionsPanel onOpen={onExtension} />}
							{active.id === 'agents' && <AgentsPanel />}
						</>
					)}
				</div>
			</main>
		</div>
	)
}
