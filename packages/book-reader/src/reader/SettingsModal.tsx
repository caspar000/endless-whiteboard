import { Highlighter, LayoutTemplate, Palette, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { stopEventPropagation } from 'tldraw'
import { Colour, HuePicker, Range, Select, Switch } from './controls'
import { BOOK_FONTS } from './fonts'
import { typingElsewhere } from './keys'
import type { HighlightTag } from '../quote/definition'
import {
	clampTo,
	DEFAULT_SETTINGS,
	READER_CONTROLS,
	type Engine,
	type ReaderControl,
	type ReaderSettings,
} from './settings'
import type { ViewMode } from './types'

export type SettingsGroup = 'layout' | 'theme' | 'tools'

const GROUPS: readonly { id: SettingsGroup; label: string; icon: typeof Palette }[] = [
	{ id: 'layout', label: 'Layout', icon: LayoutTemplate },
	{ id: 'theme', label: 'Theme', icon: Palette },
	{ id: 'tools', label: 'Tools', icon: Highlighter },
]

/**
 * Everything the reader can be told, laid out properly.
 *
 * A settings window rather than a drawer in the side panel, because these settings are wide: a
 * colour beside its strength, a slider beside its value, notes that are worth reading. Squeezing
 * them into a 248px column is what made the first attempt feel like a form rather than a control
 * room.
 *
 * The rail on the left is the same three questions the side panel asks — layout, theme, tools — so
 * opening "Customize" under one of them lands you on that page rather than at the top of a list.
 */
export function SettingsModal({
	settings,
	engine,
	viewMode,
	group,
	container,
	onChange,
	onClose,
}: {
	settings: ReaderSettings
	engine: Engine
	viewMode: ViewMode
	group: SettingsGroup
	/** Where to portal to — the editor's own container, as the reader itself does. */
	container: HTMLElement
	onChange(patch: Partial<ReaderSettings>): void
	onClose(): void
}) {
	const [page, setPage] = useState<SettingsGroup>(group)
	useEffect(() => setPage(group), [group])

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return
			// A surface over this one — the command palette — owns its own Escape. Checked before the
			// `stopPropagation` below, which would otherwise swallow the key on its way there.
			if (typingElsewhere(container)) return
			event.stopPropagation()
			onClose()
		}
		window.addEventListener('keydown', onKeyDown, { capture: true })
		return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
	}, [onClose, container])

	const applies = (control: ReaderControl) =>
		(control.engine === null || control.engine === engine) &&
		(!control.viewMode || control.viewMode === viewMode)

	/** The controls of this page, in the order given, grouped under their headings. */
	const sections = useMemo(() => {
		const out = new Map<string, ReaderControl[]>()
		for (const control of READER_CONTROLS) {
			if (control.group !== page || !applies(control)) continue
			const list = out.get(control.section)
			if (list) list.push(control)
			else out.set(control.section, [control])
		}
		return [...out]
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [page, engine, viewMode])

	const mine = READER_CONTROLS.filter((c) => c.group === page && applies(c))
	const changed = mine.some((c) => settings[c.key] !== DEFAULT_SETTINGS[c.key])
	const title = GROUPS.find((g) => g.id === page)?.label ?? ''

	return createPortal(
		<div
			className="lb-modal"
			onPointerDown={(event) => {
				stopEventPropagation(event)
				if (event.target === event.currentTarget) onClose()
			}}
			onWheel={stopEventPropagation}
		>
			<div className="lb-modal__sheet" role="dialog" aria-modal="true" aria-label="Reading settings">
				<nav className="lb-modal__rail" role="tablist" aria-label="Sections">
					<h2 className="lb-modal__rail-title">Reading</h2>
					{GROUPS.map((option) => (
						<button
							key={option.id}
							type="button"
							role="tab"
							className="lb-modal__tab"
							aria-selected={page === option.id}
							onClick={() => setPage(option.id)}
						>
							<option.icon size={15} aria-hidden />
							{option.label}
						</button>
					))}
				</nav>

				<div className="lb-modal__main">
					<header className="lb-modal__bar">
						<h3 className="lb-modal__title">{title}</h3>
						<button type="button" className="lb-modal__close" onClick={onClose} aria-label="Close">
							<X size={16} aria-hidden />
						</button>
					</header>

					<div className="lb-modal__page">
						{sections.map(([heading, controls]) => (
							<section key={heading} className="lb-modal__section">
								<h4 className="lb-modal__heading">{heading}</h4>
								<div className="lb-modal__rows">
									{controls.map((control) => (
										<Row
											key={control.key}
											control={control}
											settings={settings}
											onChange={onChange}
										/>
									))}
								</div>
							</section>
						))}
						{page === 'tools' && (
							<section className="lb-modal__section">
								<h4 className="lb-modal__heading">Highlight tags</h4>
								<TagEditor tags={settings.tags} onChange={onChange} />
							</section>
						)}
						{!sections.length && page !== 'tools' && (
							<p className="lb-modal__empty">
								Nothing to set here for this book — a comic has no type to size, and a PDF
								brings its own.
							</p>
						)}
					</div>

					<footer className="lb-modal__foot">
						<button
							type="button"
							className="lb-btn lb-btn--ghost lb-btn--icon"
							disabled={!changed}
							onClick={() => {
								const patch: Partial<ReaderSettings> = {}
								for (const c of mine) patch[c.key] = DEFAULT_SETTINGS[c.key] as never
								if (page === 'theme') patch.theme = DEFAULT_SETTINGS.theme
								onChange(patch)
							}}
						>
							<RotateCcw size={13} aria-hidden />
							Reset {title.toLowerCase()}
						</button>
						<button type="button" className="lb-btn lb-btn--primary" onClick={onClose}>
							Done
						</button>
					</footer>
				</div>
			</div>
		</div>,
		container
	)
}

/**
 * The tags a highlight can be, as a list you own.
 *
 * Names and colours both, which is a departure: everywhere else in the app an option's colour is
 * hashed from its label so that nobody has to maintain one. Here the colour *is* the meaning —
 * yellow-for-important is a convention older than the software — so the property carries chosen
 * hues (`optionHues`), and the swatch here, the chip on the card and the mark in the book all read
 * the same value.
 */
function TagEditor({
	tags,
	onChange,
}: {
	tags: readonly HighlightTag[]
	onChange(patch: { tags: HighlightTag[] }): void
}) {
	const set = (next: HighlightTag[]) => onChange({ tags: next })
	const edit = (index: number, patch: Partial<HighlightTag>) =>
		set(tags.map((tag, i) => (i === index ? { ...tag, ...patch } : tag)))

	return (
		<div className="lb-tags">
			{tags.map((tag, index) => (
				<div className="lb-tags__row" key={index}>
					<HuePicker
						hue={tag.hue}
						label={tag.label || 'Untitled'}
						onChange={(hue) => edit(index, { hue })}
					/>
					<input
						type="text"
						className="lb-tags__name"
						value={tag.label}
						aria-label="Tag name"
						onChange={(event) => edit(index, { label: event.target.value })}
					/>
					<button
						type="button"
						className="lb-tags__remove"
						// One tag has to survive, or the quote bar loses every button it has.
						disabled={tags.length <= 1}
						title="Remove tag"
						onClick={() => set(tags.filter((_, i) => i !== index))}
					>
						<Trash2 size={13} aria-hidden />
					</button>
				</div>
			))}

			<button
				type="button"
				className="lb-btn lb-btn--ghost lb-btn--icon lb-tags__add"
				onClick={() => set([...tags, { label: 'New tag', hue: (tags.length * 47 + 20) % 360 }])}
			>
				<Plus size={13} aria-hidden />
				Add tag
			</button>

			<p className="lb-modal__note lb-tags__note">
				Renaming a tag leaves quotes already marked with the old name as they are — the name is
				the value the board stores.
			</p>
		</div>
	)
}

/**
 * The choices a menu offers.
 *
 * Two of them come from elsewhere on purpose: the fonts are the ones the app actually ships, and
 * the tags belong to the quote node. Importing either into the settings module would close a
 * circle, since both already read their settings from it.
 */
function optionsFor(control: ReaderControl): readonly { id: string; label: string }[] {
	if (control.key === 'font') return BOOK_FONTS
	if (control.key === 'quoteTag') return []
	return control.options ?? []
}

/** The quote tags, which are configured rather than fixed, so the menu is built per render. */
function tagOptions(tags: readonly HighlightTag[]): readonly { id: string; label: string }[] {
	return [{ id: '', label: 'None' }, ...tags.map((tag) => ({ id: tag.label, label: tag.label }))]
}

/** One setting: its name and what it means on the left, the thing that changes it on the right. */
function Row({
	control,
	settings,
	onChange,
}: {
	control: ReaderControl
	settings: ReaderSettings
	onChange(patch: Partial<ReaderSettings>): void
}) {
	const value = settings[control.key]
	const id = `lb-set-${control.key}`
	// Touching a colour by hand means the look is yours now, not one of the presets'.
	const set = (patch: Partial<ReaderSettings>) =>
		onChange(control.kind === 'colour' ? { ...patch, theme: 'custom' } : patch)

	return (
		<div className="lb-modal__row" data-kind={control.kind}>
			<div className="lb-modal__row-text">
				<label className="lb-modal__row-label" htmlFor={id}>
					{control.label}
				</label>
				{control.note && <p className="lb-modal__note">{control.note}</p>}
			</div>

			<div className="lb-modal__row-control">
				{control.kind === 'slider' && (
					<>
						<Range
							id={id}
							value={value as number}
							min={control.min ?? 0}
							max={control.max ?? 100}
							step={control.step ?? 1}
							onChange={(next) => set({ [control.key]: clampTo(control, next) })}
						/>
						<output className="lb-modal__value">
							{control.format?.(value as number) ?? String(value)}
						</output>
					</>
				)}

				{control.kind === 'toggle' && (
					<Switch
						id={id}
						checked={value as boolean}
						onChange={(checked) => set({ [control.key]: checked })}
					/>
				)}

				{control.kind === 'colour' && (
					<Colour
						id={id}
						value={value as string}
						label={control.label}
						onChange={(next) => set({ [control.key]: next })}
					/>
				)}

				{control.kind === 'select' && (
					<Select
						id={id}
						value={value as string}
						options={control.key === 'quoteTag' ? tagOptions(settings.tags) : optionsFor(control)}
						onChange={(next) => set({ [control.key]: next })}
					/>
				)}
			</div>

			{/*
			 * A line set in the face itself, because no one can choose a reading font from its name —
			 * and on the paper it will actually be printed on, since that is half the judgement.
			 */}
			{control.key === 'font' && (
				<p
					className="lb-modal__specimen"
					style={{
						fontFamily: BOOK_FONTS.find((f) => f.id === settings.font)?.stack || 'serif',
						background: settings.pageColor,
						color: settings.textColor,
					}}
				>
					Sphinx of black quartz, <em>judge my vow</em>.
				</p>
			)}
		</div>
	)
}
