import { Columns2, ScrollText, Settings2, Square } from 'lucide-react'
import { useEffect } from 'react'
import { ensureAppFontFaces } from './fonts'
import { READER_THEMES, themeOf, themePatch, type ReaderSettings } from './settings'
import type { SettingsGroup } from './SettingsModal'
import { VIEW_MODE_LABELS, VIEW_MODES, type ViewMode } from './types'

const LAYOUT_ICONS: Record<ViewMode, typeof Square> = {
	page: Square,
	spread: Columns2,
	scroll: ScrollText,
}

/**
 * The two questions worth asking in a sidebar: what shape is the page, and what does it look like.
 *
 * Both are answered by picking a picture, because both are visual questions and nobody should have
 * to read a menu to answer them. Everything finer sits behind *Customize*, which opens the settings
 * proper — a panel this narrow is the wrong place for a colour beside its strength.
 */
export function SettingsPanel({
	settings,
	onChange,
	onCustomize,
	onClose,
}: {
	settings: ReaderSettings
	onChange(patch: Partial<ReaderSettings>): void
	onCustomize(group: SettingsGroup): void
	onClose(): void
}) {
	useEffect(ensureAppFontFaces, [])
	const active = themeOf(settings)

	return (
		<aside className="lb-reader__settings" aria-label="Reading settings">
			<header className="lb-reader__settings-head">
				<span>Reading</span>
			</header>

			<h3 className="lb-reader__settings-title">Layout</h3>
			<div className="lb-reader__cards" role="group" aria-label="Layout">
				{VIEW_MODES.map((mode) => {
					const Icon = LAYOUT_ICONS[mode]
					return (
						<button
							key={mode}
							type="button"
							className="lb-reader__card"
							aria-pressed={settings.viewMode === mode}
							onClick={() => onChange({ viewMode: mode })}
						>
							<Icon size={20} aria-hidden />
							<span>{VIEW_MODE_LABELS[mode]}</span>
						</button>
					)
				})}
			</div>
			<Customize label="Customize layout" onClick={() => onCustomize('layout')} />

			<h3 className="lb-reader__settings-title">Theme</h3>
			<div className="lb-reader__cards" role="group" aria-label="Theme">
				{READER_THEMES.map((theme) => (
					<button
						key={theme.id}
						type="button"
						className="lb-reader__card lb-reader__card--theme"
						aria-pressed={active === theme.id}
						onClick={() => onChange(themePatch(theme))}
						// The card is a swatch of the theme it applies — the only honest preview.
						style={{ background: theme.pageColor, color: theme.textColor }}
					>
						<span className="lb-reader__card-aa">Aa</span>
						<span>{theme.label}</span>
					</button>
				))}
			</div>
			<Customize label="Customize theme" onClick={() => onCustomize('theme')} />

			<h3 className="lb-reader__settings-title">Tools</h3>
			<p className="lb-reader__settings-blurb">
				Quoting, clipping and the notes you follow.
			</p>
			<Customize label="Customize tools" onClick={() => onCustomize('tools')} />

			<button type="button" className="lb-reader__settings-done" onClick={onClose}>
				Done
			</button>
		</aside>
	)
}

function Customize({ label, onClick }: { label: string; onClick(): void }) {
	return (
		<button type="button" className="lb-reader__customize" onClick={onClick}>
			<Settings2 size={13} aria-hidden />
			Customize
			<span className="lb-reader__sr">{label}</span>
		</button>
	)
}
