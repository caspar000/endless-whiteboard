import { AlertTriangle, Check, CloudOff, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

/**
 * Where a server board stands with the server (docs/fork-parity.md S5), in the board's corner. Quiet
 * when all is well:
 *
 * - offline: says so, and how many changes are kept on this device for when it's back;
 * - online with changes still going up for more than a moment: saving;
 * - the moment those have all gone up after being offline: synced, briefly;
 * - changes the server refused: says how many, until the board is opened again.
 */
export interface SyncState {
	online: boolean
	unsent: number
	refused: number
}

/** How long changes may wait online before "Saving…" shows: a usual edit is up well before. */
const SLOW_SAVE_MS = 1500
/** How long "Synced" stays after coming back. */
const SYNCED_MS = 2500

export function SyncStatusPill({ online, unsent, refused }: SyncState) {
	const [slow, setSlow] = useState(false)
	const [justSynced, setJustSynced] = useState(false)
	const wasBehind = useRef(false)

	useEffect(() => {
		if (!online || unsent === 0) {
			setSlow(false)
			return
		}
		const timer = setTimeout(() => setSlow(true), SLOW_SAVE_MS)
		return () => clearTimeout(timer)
	}, [online, unsent])

	useEffect(() => {
		if (!online) {
			wasBehind.current = true
			return
		}
		if (unsent > 0 || !wasBehind.current) return
		wasBehind.current = false
		setJustSynced(true)
		const timer = setTimeout(() => setJustSynced(false), SYNCED_MS)
		return () => clearTimeout(timer)
	}, [online, unsent])

	const pill = refused
		? {
				kind: 'warn',
				icon: <AlertTriangle size={13} />,
				text: `${refused} ${refused === 1 ? 'change' : 'changes'} couldn’t be saved and ${refused === 1 ? 'was' : 'were'} undone`,
			}
		: !online
			? {
					kind: 'offline',
					icon: <CloudOff size={13} />,
					text: unsent
						? `Offline · ${unsent} ${unsent === 1 ? 'change' : 'changes'} kept on this device`
						: 'Offline · opened from this device',
				}
			: slow
				? { kind: 'saving', icon: <RefreshCw size={13} />, text: 'Saving…' }
				: justSynced
					? { kind: 'synced', icon: <Check size={13} />, text: 'Synced' }
					: null

	if (!pill) return null
	return (
		<div className={`lb-sync-pill lb-sync-pill--${pill.kind}`} role="status" aria-live="polite" data-testid="lb.sync-status">
			{pill.icon}
			<span>{pill.text}</span>
		</div>
	)
}
