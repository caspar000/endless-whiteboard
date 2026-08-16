import { ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { sendAuthToken } from '../agent/bridge'

/**
 * The sign-in view, shown when the agent has no credentials.
 *
 * Not an error screen. Being signed out is the ordinary first run, and the VS Code extension treats
 * it that way too — so this explains the two routes in and gets out of the way, rather than
 * reporting that a turn failed.
 *
 * The two routes differ in kind, which is why both are offered. `claude login` is the normal one and
 * uses the account the user already has; a token is for a machine where the browser flow is awkward
 * — a remote box, a container — and it is the reason there is a paste box here at all.
 */

const LOGIN_DOCS = 'https://code.claude.com/docs/en/authentication'

export function AgentSignIn({ detail }: { detail: string }) {
	const [token, setToken] = useState('')
	const [sent, setSent] = useState(false)

	const submit = () => {
		if (!token.trim()) return
		sendAuthToken(token)
		// Cleared immediately: it is a credential, and leaving it sitting in a text box on screen is
		// the one thing this view should not do.
		setToken('')
		setSent(true)
	}

	return (
		<div className="lb-agent-signin">
			<h3 className="lb-agent-signin__title">Sign in to Claude</h3>
			<p className="lb-agent-signin__lede">
				The agent uses your own Claude account. {detail || 'No credentials were found on this machine.'}
			</p>

			<ol className="lb-agent-signin__steps">
				<li>
					Run <code>claude login</code> in a terminal and complete sign-in in your browser.
				</li>
				<li>Restart the dev server so the agent picks up the new credentials.</li>
			</ol>

			<a
				className="lb-agent-signin__link"
				href={LOGIN_DOCS}
				target="_blank"
				rel="noreferrer noopener"
			>
				Claude Code sign-in docs
				<ExternalLink size={12} aria-hidden="true" />
			</a>

			<div className="lb-agent-signin__divider">
				<span>or paste a token</span>
			</div>

			<p className="lb-agent-signin__note">
				For a machine where the browser flow is awkward, create one with{' '}
				<code>claude setup-token</code> and paste it here. It is held in memory by the agent
				process for this session only — nothing is written to disk.
			</p>

			<form
				className="lb-agent-signin__form"
				onSubmit={(event) => {
					event.preventDefault()
					submit()
				}}
			>
				<input
					type="password"
					className="lb-agent-signin__input"
					value={token}
					placeholder="sk-ant-…"
					onChange={(event) => {
						setToken(event.target.value)
						setSent(false)
					}}
					autoComplete="off"
					spellCheck={false}
					aria-label="Claude token"
				/>
				<button type="submit" className="lb-agent-signin__submit" disabled={!token.trim()}>
					Use token
				</button>
			</form>

			{sent && (
				<p className="lb-agent-signin__ok">
					Token saved for this session. Send a message to try it.
				</p>
			)}
		</div>
	)
}
