import {
	getDisabledExtensions,
	getExtensions,
	setExtensionEnabled,
	subscribeToNodeDefinitions,
} from '@lifeboard/node-kit'
import { Puzzle } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { persistDisabledExtensions } from '../../extensions'

/**
 * Settings → Extensions: a card per registered extension, in the visual language of Obsidian's and
 * Logseq's plugin lists — icon and name up top with a switch, description as the body, version and
 * author as the dimmed footer.
 *
 * The card is also a link to the extension's own page, because a switch is not enough to decide
 * with: this list is the place someone will eventually install work that isn't ours, and "what does
 * this actually do to my boards" has to be answerable before the switch is touched, not after.
 *
 * Toggling is a pure UI change and takes effect immediately — the registry's store feeds every
 * creation surface (dock, context menu, shortcuts) through `useSyncExternalStore`, so no board
 * remounts.
 * Disabling never touches data: an extension's types stay registered with the schema, so boards
 * containing its shapes keep opening and rendering. The copy below says exactly that, because
 * "will my notes disappear?" is the first question a toggle like this raises.
 */
export function ExtensionsPanel({ onOpen }: { onOpen: (id: string) => void }) {
	const extensions = getExtensions()
	// Subscribes to the registry's own store, so the switches re-render on toggle (including one
	// made elsewhere, e.g. the command palette). The snapshot is the live disabled set — a stable
	// reference between changes, which is what useSyncExternalStore requires.
	const disabled = useSyncExternalStore(subscribeToNodeDefinitions, getDisabledExtensions)

	const toggle = (id: string, on: boolean) => {
		setExtensionEnabled(id, on)
		persistDisabledExtensions()
	}

	if (extensions.length === 0) return null

	return (
		<section className="lb-settings">
			<h2>Installed</h2>
			<p className="lb-settings__hint">
				Every extension here ships with the app. Turning one off removes its tools and menu
				entries — anything already on your boards stays there and keeps working.
			</p>
			<ul className="lb-extmarket">
				{extensions.map((ext) => {
					const on = !disabled.has(ext.id)
					const Icon = ext.icon ?? Puzzle
					const meta = [ext.version, ext.author && `by ${ext.author}`].filter(Boolean)
					return (
						// `data-off` dims the card body, not the switch — the control you need to undo
						// the state must never fade with it.
						<li key={ext.id} className="lb-extmarket__card" data-off={on ? undefined : 'true'}>
							<header className="lb-extmarket__head">
								<span className="lb-extmarket__icon" aria-hidden="true">
									<Icon size={17} />
								</span>
								{/* A button rather than the whole card being one: the card contains a switch, and
								    an <input> inside a <button> is neither valid nor operable. This one's ::after
								    stretches over the card instead, so the click target is still the card. */}
								<button className="lb-extmarket__open" onClick={() => onOpen(ext.id)}>
									{ext.name}
								</button>
								<input
									type="checkbox"
									className="lb-toggle__input lb-extmarket__switch"
									checked={on}
									onChange={(e) => toggle(ext.id, e.target.checked)}
									aria-label={`Enable ${ext.name}`}
								/>
							</header>
							{ext.description && <p className="lb-extmarket__desc">{ext.description}</p>}
							{meta.length > 0 && (
								<footer className="lb-extmarket__meta">{meta.join(' · ')}</footer>
							)}
						</li>
					)
				})}
			</ul>
		</section>
	)
}
