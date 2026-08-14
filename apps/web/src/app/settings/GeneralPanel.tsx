import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { isAutoFetchEnabled, setAutoFetchEnabled } from '../../persistence/rateStore'
import { Toggle } from './controls'

const APP_VERSION = __APP_VERSION__

/**
 * The first tab: the settings that belong to the app rather than to a surface of it, and the version.
 *
 * Thin today on purpose — it is where a preference lands when it is plainly not appearance, not the
 * canvas, not storage and not an extension's.
 */
export function GeneralPanel() {
	return (
		<>
			<section className="lb-settings">
				<h2>Currency</h2>

				<div className="lb-appearance__card">
					<ExchangeRateToggle />
				</div>
			</section>

			<section className="lb-settings">
				<h2>About</h2>

				<div className="lb-appearance__card">
					<div className="lb-appearance__row">
						<div className="lb-appearance__label">Version</div>
						<div className="lb-appearance__value">Lifeboard {APP_VERSION}</div>
					</div>
					<p className="lb-appearance__hint">
						Everything you make stays on this device. The one exception is exchange rates, above.
					</p>
				</div>
			</section>
		</>
	)
}

/**
 * The app's only outbound network call, so it gets a switch.
 *
 * Local state rather than a hook: nothing else in the app reacts to this, and the rate store reads the
 * flag straight from storage when it next needs rates. Switching it off leaves any cached table in
 * place, so totals keep converting — just with rates that stop moving.
 */
function ExchangeRateToggle() {
	const [enabled, setEnabled] = useState(isAutoFetchEnabled)
	return (
		<Toggle
			label="Update exchange rates"
			hint="Fetches daily rates to convert between currencies. Nothing about your boards is sent."
			icon={RefreshCw}
			checked={enabled}
			onChange={(next) => {
				setEnabled(next)
				setAutoFetchEnabled(next)
			}}
		/>
	)
}
