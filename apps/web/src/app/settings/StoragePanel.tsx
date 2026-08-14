import { useCallback, useEffect, useState } from 'react'
import { getLastBackupAt } from '../../boards/boardIndex'
import { backupFileName, exportBackup, importBackup } from '../../persistence/backup'
import { usePlatform } from '../../platform/PlatformContext'
import type { StorageEstimate } from '../../platform/PlatformAdapter'
import type { BoardsApi } from '../useBoards'

const APP_VERSION = __APP_VERSION__

function formatBytes(bytes: number | null): string {
	if (bytes === null) return 'unknown'
	if (bytes < 1024) return `${bytes} B`
	const units = ['KB', 'MB', 'GB']
	let value = bytes / 1024
	let i = 0
	while (value >= 1024 && i < units.length - 1) {
		value /= 1024
		i++
	}
	return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`
}

function daysSince(ts: number): number {
	return Math.floor((Date.now() - ts) / 86_400_000)
}

/**
 * Storage and backup panel (§4.4 "Quota"). The nag exists because Safari can evict IndexedDB for
 * sites that aren't installed — a one-click backup plus a visible "last backup N days ago" is the
 * mitigation the plan calls for, not a nice-to-have.
 */
export function StoragePanel({
	api,
	onImported,
}: {
	api: BoardsApi
	/** Called after a successful import so the caller can show the restored boards. */
	onImported?: () => void
}) {
	const platform = usePlatform()
	const [estimate, setEstimate] = useState<StorageEstimate | null>(null)
	const [lastBackup, setLastBackup] = useState<number | null>(null)
	const [busy, setBusy] = useState<'export' | 'import' | null>(null)
	const [message, setMessage] = useState<string | null>(null)

	const refreshStatus = useCallback(async () => {
		setEstimate(await platform.estimateStorage())
		setLastBackup(await getLastBackupAt(platform.kv))
	}, [platform])

	useEffect(() => {
		void refreshStatus()
	}, [refreshStatus])

	const onExport = async () => {
		setBusy('export')
		setMessage(null)
		try {
			const result = await exportBackup(platform, APP_VERSION)
			await platform.saveFile(backupFileName(), result.blob)
			setMessage(
				[
					`Exported ${result.boardCount} board${result.boardCount === 1 ? '' : 's'} and ${result.assetCount} image${result.assetCount === 1 ? '' : 's'} (${formatBytes(result.blob.size)}).`,
					...result.warnings,
				].join(' ')
			)
			await refreshStatus()
		} catch (err) {
			setMessage(`Export failed: ${err instanceof Error ? err.message : String(err)}`)
		} finally {
			setBusy(null)
		}
	}

	const onImport = async () => {
		const file = await platform.openFile(['.zip', 'application/zip'])
		if (!file) return
		setBusy('import')
		setMessage(null)
		try {
			const result = await importBackup(platform, file)
			await api.refresh()
			// Land the user on the boards they just restored: staying on this panel means the import
			// reports success while the thing it produced is nowhere in sight.
			onImported?.()
			setMessage(
				[
					`Imported ${result.boardsImported} board${result.boardsImported === 1 ? '' : 's'} as copies.`,
					...result.warnings,
				].join(' ')
			)
			await refreshStatus()
		} catch (err) {
			setMessage(`Import failed: ${err instanceof Error ? err.message : String(err)}`)
		} finally {
			setBusy(null)
		}
	}

	const staleBackup = lastBackup === null || daysSince(lastBackup) >= 7

	return (
		<section className="lb-settings">
			<h2>Storage &amp; backup</h2>

			<dl className="lb-settings__stats">
				<div>
					<dt>Used</dt>
					<dd>
						{formatBytes(estimate?.usage ?? null)}
						{estimate?.quota ? ` of ${formatBytes(estimate.quota)}` : ''}
					</dd>
				</div>
				<div>
					<dt>Durable storage</dt>
					<dd>{estimate?.persisted ? 'granted' : 'not granted'}</dd>
				</div>
				<div>
					<dt>Last backup</dt>
					<dd>
						{lastBackup === null
							? 'never'
							: daysSince(lastBackup) === 0
								? 'today'
								: `${daysSince(lastBackup)} days ago`}
					</dd>
				</div>
			</dl>

			{!estimate?.persisted && (
				<p className="lb-settings__warn">
					The browser has not granted durable storage, so it may evict this data to reclaim space.
					Keep a recent backup — and installing the app makes storage durable on iOS.
				</p>
			)}

			{staleBackup && api.boards.length > 0 && (
				<p className="lb-settings__warn">
					{lastBackup === null
						? 'You have never exported a backup.'
						: `Your last backup was ${daysSince(lastBackup)} days ago.`}
				</p>
			)}

			<div className="lb-settings__actions">
				<button className="lb-btn" onClick={onExport} disabled={busy !== null}>
					{busy === 'export' ? 'Exporting…' : 'Export backup (.zip)'}
				</button>
				<button className="lb-btn" onClick={onImport} disabled={busy !== null}>
					{busy === 'import' ? 'Importing…' : 'Import backup'}
				</button>
			</div>

			{message && <p className="lb-settings__message">{message}</p>}
		</section>
	)
}
