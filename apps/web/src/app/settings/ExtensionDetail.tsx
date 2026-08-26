import {
	getDisabledExtensions,
	getExtension,
	setExtensionEnabled,
	subscribeToNodeDefinitions,
	type NodeToolbarIcon,
} from '@lifeboard/node-kit'
import { ChevronLeft, Puzzle } from 'lucide-react'
import { useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { persistDisabledExtensions } from '../../extensions'
import { formatKbd, isMacPlatform } from '../paletteItems'

/** One line under "What it adds" — a thing the extension puts into the app. */
interface Contribution {
	label: string
	icon?: NodeToolbarIcon
	/** A glyph fallback for node definitions, which always have one and may have no icon component. */
	glyph?: string
	kbd?: string
}

/**
 * An extension's own page: what it is, what it adds, and the switch.
 *
 * The "what it adds" list is derived from the manifest rather than written per extension. That is
 * the point of the manifest being the unit of packaging — the host can tell you that Books brings
 * two node types, four commands and five file formats without anyone remembering to describe them
 * twice, and a third-party extension gets the same page for free.
 */
export function ExtensionDetail({ id, onBack }: { id: string; onBack: () => void }) {
	const ext = getExtension(id)
	const disabled = useSyncExternalStore(subscribeToNodeDefinitions, getDisabledExtensions)
	const mac = useMemo(() => isMacPlatform(), [])

	const back = (
		<button className="lb-extpage__back" onClick={onBack}>
			<ChevronLeft size={15} />
			All extensions
		</button>
	)

	if (!ext) {
		return (
			<section className="lb-settings">
				{back}
				{/* A dead link, most likely: an id that used to exist, or one from a build that had an
				    extension this one doesn't. */}
				<p className="lb-settings__hint">No extension with the id “{id}” is installed.</p>
			</section>
		)
	}

	const on = !disabled.has(ext.id)
	const Icon = ext.icon ?? Puzzle
	const meta = [ext.version && `Version ${ext.version}`, ext.author && `by ${ext.author}`].filter(
		Boolean
	)

	const groups: { title: string; items: Contribution[] }[] = [
		{
			title: 'Node types',
			items: ext.nodes.map((node) => ({
				label: node.label,
				icon: node.toolbarIcon,
				glyph: node.icon,
				kbd: node.kbd,
			})),
		},
		{
			title: 'Commands',
			items: (ext.commands ?? []).map((command) => ({
				label: command.title,
				icon: command.icon,
				kbd: command.kbd,
			})),
		},
		{
			// Listed because this page's premise is that the manifest describes the extension — an
			// extension whose operations were missing here would show an incomplete "what it adds", and
			// operations are the half of it an agent can reach.
			title: 'Agent operations',
			items: (ext.operations ?? []).map((operation) => ({ label: operation.title })),
		},
		{
			// Vocabulary rather than capability, and worth naming for exactly that reason: turning the
			// extension off takes these words out of every note's `{…}` menu, which is a change to what
			// the boards you already wrote can say. Nothing else on this page has that reach.
			title: 'Questions it teaches',
			items: (ext.queries ?? []).map((query) => ({ label: query.name })),
		},
		{
			title: 'Opens these files',
			items: (ext.fileImports ?? []).flatMap((imp) =>
				imp.extensions.map((suffix) => ({ label: `.${suffix}` }))
			),
		},
		{
			// Listed as a count rather than by pattern: "matches(text)" is a function, so unlike a file
			// suffix there is nothing truthful to print — and the page's premise is that it describes
			// the extension, so a contribution that changes what dropping something does cannot be absent.
			title: 'Dropped links and text',
			items: (ext.contentImports ?? []).map(() => ({ label: 'Claims links and pasted text' })),
		},
		{
			title: 'Right-click actions',
			items: (ext.actions ?? []).map((action) => ({ label: action.label, icon: action.icon })),
		},
		{
			// An overlay is the one contribution with nothing to name it by — it is a component, not a
			// labelled verb — so its id is what the page can honestly show. Worth a row anyway: chrome
			// that appears on the canvas is the most visible thing an extension can add, and a page that
			// omitted it would be describing a quieter extension than the one you installed.
			title: 'Draws on the canvas',
			items: (ext.overlays ?? []).map((overlay) => ({ label: overlay.id })),
		},
		{
			// The palette rows an extension builds from what you type. Not in the command table, so this is
			// the one contribution the page would otherwise be unable to mention.
			title: 'Answers in ⌘K',
			items: (ext.commandSources ?? []).map((source) => ({ label: source.id })),
		},
	].filter((group) => group.items.length > 0)

	return (
		<>
			<section className="lb-settings">
				{back}

				<header className="lb-extpage__head">
					<span className="lb-extpage__icon" aria-hidden="true">
						<Icon size={26} />
					</span>
					<div className="lb-extpage__ident">
						<h1 className="lb-extpage__name">{ext.name}</h1>
						{meta.length > 0 && <p className="lb-extpage__meta">{meta.join(' · ')}</p>}
					</div>
					<label className="lb-extpage__switch">
						<span>{on ? 'Enabled' : 'Disabled'}</span>
						<input
							type="checkbox"
							className="lb-toggle__input"
							checked={on}
							onChange={(e) => {
								setExtensionEnabled(ext.id, e.target.checked)
								persistDisabledExtensions()
							}}
							aria-label={`Enable ${ext.name}`}
						/>
					</label>
				</header>

				{ext.description && <p className="lb-extpage__lede">{ext.description}</p>}

				{ext.details?.map((paragraph) => (
					<p key={paragraph} className="lb-extpage__para">
						{paragraph}
					</p>
				))}
			</section>

			{/*
			  * The extension's own controls, above the derived list — see `Extension.settings`. A setting is
			  * something you came here to change; "what it adds" is something you came here to read.
			  */}
			{ext.settings && (
				<section className="lb-settings">
					<h2>{ext.settings.title}</h2>
					<ext.settings.Component />
				</section>
			)}

			{groups.length > 0 && (
				<section className="lb-settings">
					<h2>What it adds</h2>
					<div className="lb-appearance__card">
						{groups.map((group) => (
							<div className="lb-extpage__group" key={group.title}>
								<div className="lb-extpage__grouptitle">{group.title}</div>
								<ul className="lb-extpage__items">
									{group.items.map((item) => (
										<li className="lb-extpage__item" key={item.label}>
											<ContributionIcon {...item} />
											<span className="lb-extpage__itemlabel">{item.label}</span>
											{item.kbd && <kbd className="lb-kbd">{formatKbd(item.kbd, mac)}</kbd>}
										</li>
									))}
								</ul>
							</div>
						))}
					</div>
				</section>
			)}

			<section className="lb-settings">
				<h2>Identifier</h2>
				<div className="lb-appearance__card">
					{/* The id is what a keymap, an expression or another extension refers to this one by,
					    so it is worth being able to copy off the page. */}
					<code className="lb-extpage__id">{ext.id}</code>
				</div>
			</section>
		</>
	)
}

function ContributionIcon({ icon: Icon, glyph }: Contribution): ReactNode {
	if (Icon) {
		return (
			<span className="lb-extpage__itemicon" aria-hidden="true">
				<Icon size={15} />
			</span>
		)
	}
	if (glyph) {
		return (
			<span className="lb-extpage__itemicon" aria-hidden="true">
				{glyph}
			</span>
		)
	}
	return <span className="lb-extpage__itemicon" aria-hidden="true" />
}
