import { useState } from 'react'
import { METRIC_KEYS, METRICS } from '@lifeboard/health-core'
import { clearHealth, exportHealth, refreshHealth, restoreHealth, setHealthPaused, setHealthToken, useHealth } from './store'

export function HealthSettings() {
  const health = useHealth()
  const [key, setKey] = useState('')
  const [message, setMessage] = useState('')
  const [clearing, setClearing] = useState(false)
  async function run(action: () => Promise<void>, success: string) {
    setMessage('')
    try { await action(); setMessage(success) } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not complete this action.') }
  }
  return <div className="lb-health-settings">
    <div className="lb-health-setup">
      <div className="lb-health-eyebrow">IPHONE → ICLOUD DRIVE → THIS MAC</div>
      <h3>A little history, a clearer picture</h3>
      <p>Send daily Apple Health summaries from Health Auto Export to iCloud Drive. The local service reads that folder; your cards follow along.</p>
      <ol>
        <li>In Health Auto Export, create an <strong>iCloud Drive</strong> automation named <strong>Lifeboard</strong>. Choose Health Metrics, JSON version 2, daily files, and daily time grouping. Turn on summarized data and aggregated sleep.</li>
        <li>Select the metrics you want and set Preferred Sources in the exporter. Start with a manual 7-day export, then enable daily automation. Ensure the exported folder is downloaded on your Mac.</li>
        <li>Start the local service using the command in <code>docs/apple-health-setup.md</code>, with the export folder's actual Mac path. Keep that process running while the whiteboard is closed.</li>
      </ol>
      <p>Automatic export needs the exporter's Premium tier and may wait for your iPhone to unlock. Only data already readable in Apple Health can appear here.</p>
    </div>
    <div className="lb-health-controls">
      <h3>Connection</h3>
      <label>Service access key <span>(only needed when serving the built app directly)</span><input type="password" value={key} autoComplete="off" onChange={e => setKey(e.target.value)} placeholder="The development server connects automatically" /></label>
      <p>The key stays in memory and is never saved with boards or health backups.</p>
      <div className="lb-health-buttons"><button disabled={health.busy} onClick={() => { setHealthToken(key); setHealthPaused(false); void refreshHealth() }}>{health.busy ? 'Refreshing…' : 'Connect / refresh'}</button><button onClick={() => setHealthPaused(!health.paused)}>{health.paused ? 'Resume refresh' : 'Pause refresh'}</button></div>
      <p role="status">{health.paused ? 'Refresh paused.' : health.connected ? 'Connected to the local service.' : 'Service not connected.'} {health.snapshot ? `${health.snapshot.records.length.toLocaleString()} daily records available offline.` : 'No health records imported yet.'}</p>
      {health.checkedAt && <p>Folder checked: {new Date(health.checkedAt).toLocaleString()} · {health.files} JSON files</p>}
      {health.snapshot?.importedAt && <p>History last changed: {new Date(health.snapshot.importedAt).toLocaleString()}</p>}
      {health.error && <p className="lb-health-error">{health.error}</p>}
      {health.warnings.length > 0 && <ul>{health.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>}
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
