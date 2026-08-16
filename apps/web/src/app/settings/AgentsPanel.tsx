import { getVisibleOperations, subscribeToOperations } from '@lifeboard/node-kit'
import { Bot, Eye } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { getAgentStatus, subscribeToAgentStatus } from '../../agent/bridge'
import { getDevHost, subscribeToDevHost } from '../../agent/devHost'
import {
	DEFAULT_AGENT_PORT,
	getAgentPrefs,
	setAgentPrefs,
	subscribeToAgentPrefs,
	type AgentPrefs,
} from '../../agent/prefs'
import { Toggle } from './controls'

const STATUS_LABEL: Record<string, string> = {
	off: 'Off',
	connecting: 'Waiting for the server…',
	connected: 'Connected',
	error: 'Not connected',
}

/**
 * Settings → Agents: the switch, the secret, and a live account of what is being done to your boards.
 *
 * The visibility is the feature. An agent editing a board silently is the failure mode this whole
 * subsystem has to be designed against, so the page says whether something is connected and what it
 * last ran, and the switch is a kill switch that takes effect immediately.
 *
 * Its own tab rather than a section under Extensions, even though both live under Add-ons: an
 * extension is something you install, and this is something you *grant*. Putting a "let a process
 * outside the browser change my boards" switch at the bottom of a list of node types would be the
 * one setting nobody scrolls to.
 */
export function AgentsPanel() {
	const prefs = useSyncExternalStore(subscribeToAgentPrefs, getAgentPrefs)
	const status = useSyncExternalStore(subscribeToAgentStatus, getAgentStatus)
	const operations = useSyncExternalStore(subscribeToOperations, getVisibleOperations)
	const devHost = useSyncExternalStore(subscribeToDevHost, getDevHost)

	// Writes to the store; App owns the connection and follows it. Deliberately not started here —
	// this page unmounts the moment you leave Settings, which is when an agent's work begins.
	const update = (next: Partial<AgentPrefs>) => setAgentPrefs({ ...prefs, ...next })

	const offered = prefs.readOnly ? operations.filter((op) => op.readOnly).length : operations.length

	return (
		<>
			<section className="lb-settings">
				<h2>Access</h2>
				<p className="lb-settings__hint">
					Lets an MCP server on this machine read and change your boards, so a coding agent can
					create boards, add nodes and draw relations. Start the server first — it prints a token —
					then paste that token below and switch this on.
				</p>

				<div className="lb-appearance__card">
					<Toggle
						label="Allow agent access"
						hint="Off by default. Nothing outside this browser can reach your boards until you turn it on."
						icon={Bot}
						checked={prefs.enabled}
						onChange={(enabled) => update({ enabled })}
					/>
					<Toggle
						label="Read-only"
						hint="Offers only the operations that read. Anything that would change a board is withheld."
						icon={Eye}
						checked={prefs.readOnly}
						onChange={(readOnly) => update({ readOnly })}
					/>
				</div>
			</section>

			<section className="lb-settings">
				<h2>Connection</h2>

				{devHost && (
					// The fields below are still shown, and still editable, but they are not what is in
					// effect — saying so is the difference between "these are ignored" and a user changing
					// a port and wondering why nothing happened.
					<p className="lb-settings__hint">
						<strong>Managed by the dev server.</strong> It started an agent host on port{' '}
						{devHost.port} and handed the app its token, so there is nothing to set up here. The
						settings below are used instead when you connect to an MCP server yourself — note that
						the app holds one agent connection at a time, so the managed host has this one.
					</p>
				)}

				<div className="lb-appearance__card">
					<div className="lb-appearance__row">
						<label className="lb-appearance__label" htmlFor="lb-agent-token">
							Token
						</label>
						<input
							id="lb-agent-token"
							type="password"
							className="lb-appearance__input lb-agent__token"
							value={prefs.token}
							placeholder="Printed by the MCP server at startup"
							onChange={(e) => update({ token: e.target.value.trim() })}
							// A password field so it does not sit in plain sight on a shared screen. It is a
							// local secret rather than an account credential — but anything that can drive your
							// boards is worth not shoulder-surfing.
							autoComplete="off"
							spellCheck={false}
						/>
					</div>

					<div className="lb-appearance__row">
						<label className="lb-appearance__label" htmlFor="lb-agent-port">
							Port
						</label>
						<input
							id="lb-agent-port"
							type="number"
							className="lb-appearance__input lb-appearance__input--short"
							value={prefs.port}
							min={1}
							max={65535}
							onChange={(e) => update({ port: Number(e.target.value) || DEFAULT_AGENT_PORT })}
						/>
					</div>

					<p className="lb-appearance__hint lb-agent__status" data-state={status.connection}>
						<strong>{STATUS_LABEL[status.connection] ?? status.connection}</strong>
						{status.detail ? ` — ${status.detail}` : ''}
						{status.connection === 'connected' && (
							<>
								{' '}
								Offering {offered} operations{prefs.readOnly ? ' (reading only)' : ''}.{' '}
								{status.handled} run this session
								{status.lastOperation ? `, most recently ${status.lastOperation}` : ''}.
							</>
						)}
					</p>
				</div>
			</section>

			<section className="lb-settings">
				<h2>What an agent can do</h2>

				<div className="lb-appearance__card">
					<p className="lb-appearance__hint">
						The connection is to 127.0.0.1 only, and one app at a time. Everything an agent does
						goes into the board’s undo history, one step per action — so you can take back its work
						the same way you take back your own. Deleting a board is the exception: it cannot be
						undone, so that operation asks for confirmation.
					</p>
				</div>
			</section>
		</>
	)
}
