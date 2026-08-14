import { Columns2, ScrollText, SlidersHorizontal, Square } from 'lucide-react'
import { useEffect } from 'react'
import { Swatch, Switch } from './controls'
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
 * The questions worth asking beside the page: what shape it is, what it looks like, and what the
 * quote button does.
 *
 * The first two are answered by picking a picture, because both are visual questions and nobody
 * should have to read a menu to answer them. Everything finer sits behind the *Customize* button in
 * each heading, which opens the settings proper on that same section — a 248px column is the wrong
 * place for a colour beside its strength.
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
			<header className="lb-reader__settings-head">Reading</header>

			<div className="lb-reader__settings-body">
				<section>
					<h3 className="lb-reader__settings-title">Layout</h3>
					<div className="lb-reader__tiles" role="group" aria-label="Layout">
						{VIEW_MODES.map((mode) => {
							const Icon = LAYOUT_ICONS[mode]
							return (
								<button
									key={mode}
									type="button"
									className="lb-reader__tile"
									aria-pressed={settings.viewMode === mode}
									onClick={() => onChange({ viewMode: mode })}
								>
									<Icon size={20} aria-hidden />
									<span>{VIEW_MODE_LABELS[mode]}</span>
								</button>
							)
						})}
					</div>
					<Customize label="layout" onClick={() => onCustomize('layout')} />
				</section>

				<section>
					<h3 className="lb-reader__settings-title">Theme</h3>
					<div className="lb-reader__tiles" role="group" aria-label="Theme">
						{READER_THEMES.map((theme) => (
							<button
								key={theme.id}
								type="button"
								className="lb-reader__tile lb-reader__tile--theme"
								aria-pressed={active === theme.id}
								onClick={() => onChange(themePatch(theme))}
								// The tile is a swatch of the theme it applies — the only honest preview.
								style={{ background: theme.pageColor, color: theme.textColor }}
							>
								<span className="lb-reader__tile-aa">Aa</span>
								<span>{theme.label}</span>
							</button>
						))}
					</div>
					<Customize label="theme" onClick={() => onCustomize('theme')} />
				</section>

				<section>
					<h3 className="lb-reader__settings-title">Tools</h3>

					{/*
					 * The two answers worth having beside the page: what the plain quote button marks a
					 * passage as, and whether a new quote is joined to its book. Both are the settings
					 * the window behind *Customize* shows — the same values, in the space there is.
					 */}
					<div className="lb-reader__field">
						<span className="lb-reader__field-label" id="lb-quote-tag">
							Quote tag
						</span>
						<div className="lb-reader__swatches" role="group" aria-labelledby="lb-quote-tag">
							<button
								type="button"
								className={
									settings.quoteTag
										? 'lb-reader__none'
										: 'lb-reader__none lb-reader__none--on'
								}
								title="No tag"
								aria-label="No tag"
								aria-pressed={!settings.quoteTag}
								onClick={() => onChange({ quoteTag: '' })}
							/>
							{/* Keyed by position: two tags may share a name while one of them is being renamed. */}
							{settings.tags.map((tag, index) => (
								<Swatch
									key={index}
									hue={tag.hue}
									label={tag.label}
									pressed={settings.quoteTag === tag.label}
									onClick={() => onChange({ quoteTag: tag.label })}
								/>
							))}
						</div>
					</div>

					<label className="lb-reader__switch-row">
						<span>Link quotes to the book</span>
						<Switch
							small
							checked={settings.quoteArrow}
							onChange={(quoteArrow) => onChange({ quoteArrow })}
						/>
					</label>
					<Customize label="tools" onClick={() => onCustomize('tools')} />
				</section>
			</div>

			<footer className="lb-reader__settings-foot">
				<button type="button" className="lb-btn lb-reader__settings-done" onClick={onClose}>
					Done
				</button>
			</footer>
		</aside>
	)
}

/** The way through to this section's page of the settings proper, under the section it opens. */
function Customize({ label, onClick }: { label: string; onClick(): void }) {
	return (
		<button type="button" className="lb-reader__customize" onClick={onClick}>
			<SlidersHorizontal size={13} aria-hidden />
			Customize
			<span className="lb-reader__sr">{label}</span>
		</button>
	)
}
