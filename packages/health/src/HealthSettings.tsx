import { useEffect, useState } from 'react'
import { METRIC_KEYS, METRICS } from '@lifeboard/health-core'
import { chooseHealthFolder, clearHealth, configureHealthFolder, exportHealth, refreshHealth, restoreHealth, setHealthPaused, setHealthToken, useHealth } from './store'

export function HealthSettings() {
  const health = useHealth()
  const [key, setKey] = useState('')
  const [message, setMessage] = useState('')
  const [clearing, setClearing] = useState(false)
  const [folder, setFolder] = useState(health.folder ?? '')
  useEffect(() => { if (health.folder) setFolder(health.folder) }, [health.folder])
  async function run(action: () => Promise<void>, success: string) {
    setMessage('')
    try { await action(); setMessage(success) } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not complete this action.') }
  }
  async function chooseFolder() {
    setMessage('Opening the macOS folder picker…')
    const selected = await chooseHealthFolder()
    setMessage(selected ? 'Export folder selected and scanned.' : 'No folder selected.')
  }
  async function saveFolder() {
    setMessage('')
    const normalized = folder.trim().replace(/\\([ ~])/g, '$1')
    setFolder(normalized)
    if (await configureHealthFolder(normalized)) setMessage('Folder saved and scanned.')
  }
  return <div className="lb-health-settings">
    <div className="lb-health-setup">
      <div className="lb-health-eyebrow">1 · SET UP THE IPHONE EXPORT</div>
      <h3>Export Apple Health to iCloud Drive</h3>
      <p>In Health Auto Export, add an <strong>iCloud Drive</strong> automation with:</p>
      <ol>
        <li><strong>Health Metrics · JSON · Version 2</strong></li>
        <li><strong>Date Range: Day · Time Grouping: Days · Summarize Data: On</strong></li>
        <li>Select your metrics and Preferred Sources, then run a manual seven-day export once.</li>
      </ol>
      <p>The filenames do not matter. Lifeboard reads every JSON export inside the selected folder, including dated subfolders. Automatic runs can wait until the iPhone is unlocked.</p>
    </div>
    <div className="lb-health-controls">
      <div className="lb-health-eyebrow">2 · CHOOSE THE EXPORTED FOLDER</div>
      <h3>Import folder</h3>
      <p>Running <code>pnpm dev</code> starts the importer automatically. Choose the folder created by Health Auto Export in iCloud Drive.</p>
      <label>Export folder<input aria-label="Export folder" value={folder} onChange={e => setFolder(e.target.value)} placeholder="Choose the AutoExport folder…" /></label>
      <div className="lb-health-buttons">
        <button disabled={health.busy} onClick={() => void chooseFolder()}>Choose folder…</button>
        <button disabled={health.busy || !folder.trim()} onClick={() => void saveFolder()}>Use this path</button>
        <button disabled={health.busy || !health.folder} onClick={() => { setHealthToken(key); setHealthPaused(false); void refreshHealth() }}>{health.busy ? 'Scanning…' : 'Scan now'}</button>
        <button onClick={() => setHealthPaused(!health.paused)}>{health.paused ? 'Resume automatic scans' : 'Pause automatic scans'}</button>
      </div>
      <p role="status">{!health.folder ? 'Choose an export folder to begin.' : health.paused ? 'Automatic scans paused.' : health.connected ? 'Import is ready.' : 'Connecting to the importer…'} {health.snapshot ? `${health.snapshot.records.length.toLocaleString()} daily records available offline.` : ''}</p>
      {health.folder && <p className="lb-health-folder">Watching <code>{health.folder}</code></p>}
      {health.checkedAt && <p>Folder checked: {new Date(health.checkedAt).toLocaleString()} · {health.files} JSON files</p>}
      {health.folder && health.checkedAt && health.files === 0 && <p className="lb-health-error">No JSON exports were found. Choose the folder containing files such as AutoExport-2026-09-08.json, rather than the AutoSync folder of .hae files.</p>}
      {health.snapshot?.importedAt && <p>History last changed: {new Date(health.snapshot.importedAt).toLocaleString()}</p>}
      {health.error && <p className="lb-health-error">{health.error}</p>}
      {health.warnings.length > 0 && <ul>{health.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>}
      <details><summary>Advanced connection</summary><label>Service access key <span>Only needed when Lifeboard is served as a production build.</span><input type="password" value={key} autoComplete="off" onChange={e => setKey(e.target.value)} /></label><p>The key stays in memory and is excluded from all backups.</p></details>
    </div>
    <div className="lb-health-controls">
      <h3>Available history</h3>
      <table><thead><tr><th>Metric</th><th>Days</th><th>Latest</th><th>Sources</th></tr></thead><tbody>{METRIC_KEYS.map(metric => {
        const rows = health.snapshot?.records.filter(r => r.metric === metric) ?? []
        return <tr key={metric}><td>{METRICS[metric].label}</td><td>{new Set(rows.map(r => r.day)).size || '—'}</td><td>{rows.map(r => r.day).sort().at(-1) ?? 'No readable data'}</td><td>{[...new Set(rows.map(r => r.source))].join(', ') || '—'}</td></tr>
      })}</tbody></table>
      <p>Use “Create Apple Health dashboard” in the command palette on a board, or add individual metric cards from the node picker. Double-click a card to choose its period and visualization.</p>
    </div>
    <div className="lb-health-controls">
      <h3>Backup and offline data</h3>
      <p>Board backups contain card layouts and dataset references. Save a separate health backup to preserve the readings. Health backups contain personal data; service keys are excluded.</p>
      <div className="lb-health-buttons"><button disabled={!health.snapshot} onClick={() => void run(exportHealth, 'Health backup saved.')}>Export health backup</button><button onClick={() => void run(restoreHealth, 'Backup restored when a file was selected. Refresh is paused for offline review.')}>Restore health backup</button><button onClick={() => setClearing(true)}>Clear offline cache…</button></div>
      {clearing && <div className="lb-health-confirm"><p>Remove this browser's health cache? The local service history and iCloud files remain available. Refresh will pause.</p><button onClick={() => void run(async () => { await clearHealth(); setClearing(false) }, 'Offline cache removed.')}>Clear cache</button><button onClick={() => setClearing(false)}>Cancel</button></div>}
      <p>Health readings stay outside the board property system. Agent image requests containing health cards are blocked. Manually shared screenshots and notes are still shared content.</p>
      {message && <p role="status">{message}</p>}
    </div>
  </div>
}
