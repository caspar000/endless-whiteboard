import { useEffect, useMemo, useState } from 'react'
import { NodeEditorPopover, updateNodeProps, type NodeComponentProps } from '@lifeboard/node-kit'
import { dateWindow, daysIn, displayValue, isDay, METRICS, selectSeries, shiftDay, summarize, todayIn, type Metric } from '@lifeboard/health-core'
import { HealthChart } from './Chart'
import type { HealthNodeProps } from './definition'
import { useHealth } from './store'

const OVERVIEW: Metric[] = ['steps', 'activeEnergy', 'sleep', 'weight', 'hrv', 'restingHeartRate']
export function HealthNode({ shape, editor, isEditing }: NodeComponentProps<HealthNodeProps>) {
  const health = useHealth()
  const [clock, setClock] = useState(() => new Date())
  useEffect(() => { const timer = setInterval(() => setClock(new Date()), 60_000); return () => clearInterval(timer) }, [])
  const p = shape.props
  const snapshot = health.snapshot
  const ready = snapshot && p.datasetId === snapshot.datasetId
  const today = todayIn(snapshot?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone, clock)
  const window = dateWindow(p.range, today, p.start, p.end)
  const invalidDates = p.range === 'fixed' && (!isDay(p.start) || !isDay(p.end) || p.start > p.end || (Date.parse(p.end) - Date.parse(p.start)) / 86400000 >= 730)
  const days = daysIn(window.start, window.end).length
  const overview = shape.type === 'node.health.overview'
  const metric = p.metric
  const def = METRICS[metric]
  const records = ready ? snapshot.records : []
  const series = useMemo(() => selectSeries(records, metric, window.start, window.end, p.source), [records, metric, window.start, window.end, p.source])
  const value = summarize(metric, series.rows)
  const previous = useMemo(() => selectSeries(records, metric, shiftDay(window.start, -days), shiftDay(window.start, -1), series.selected), [records, metric, window.start, days, series.selected])
  const previousValue = summarize(metric, previous.rows)
  const comparable = series.rows.length === days && previous.rows.length === days && !series.ambiguous && !previous.ambiguous
  const change = comparable && previousValue !== null && previousValue !== 0 && value !== null ? (value - previousValue) / Math.abs(previousValue) * 100 : null
  const patch = (props: Partial<HealthNodeProps>) => updateNodeProps(editor, shape, props)
  const lastDay = series.rows.at(-1)?.day
  const stale = lastDay && lastDay < shiftDay(today, -2)
  const headline = overview ? (p.range === 'lastWeek' ? 'Last week, in perspective' : 'Your health overview') : def.label
  const unavailable = !snapshot ? 'Connect Health Auto Export in Settings → Extensions → Apple Health.' : !p.datasetId ? 'Double-click to connect this card to your health history.' : 'This card belongs to another health dataset. Restore its backup or reconnect it.'
  return <>
    <article className={`lb-health-node ${overview ? 'lb-health-node--overview' : ''}`} data-testid={`health-${overview ? 'overview' : metric}`}>
      <div className="lb-health-eyebrow"><span>APPLE HEALTH</span><span>{health.paused ? 'PAUSED' : health.connected ? 'LOCAL SYNC' : 'OFFLINE CACHE'}</span></div>
      <h3>{headline}</h3>
      <div className="lb-health-period">{invalidDates ? 'Choose valid dates' : `${window.start} — ${window.end}`}</div>
      {invalidDates ? <p className="lb-health-empty">Double-click to choose an ordered date range shorter than two years.</p> : !ready ? <p className="lb-health-empty">{unavailable}</p> : overview ? <div className="lb-health-overview-grid">
        {OVERVIEW.map(key => {
          const s = selectSeries(records, key, window.start, window.end)
          return <div key={key}><span>{METRICS[key].label}</span><strong>{s.ambiguous ? '—' : displayValue(key, summarize(key, s.rows))}<small>{METRICS[key].unit}</small></strong><span>{s.ambiguous ? 'Multiple sources; use a metric card to choose' : `${s.rows.length}/${days} days · ${METRICS[key].summary === 'sum' ? 'total' : METRICS[key].summary === 'latest' ? 'latest' : 'daily average'}`}</span></div>
        })}
      </div> : series.ambiguous ? <p className="lb-health-empty">Several sources recorded this metric. Double-click and choose one to avoid counting it twice.</p> : <>
        <div className="lb-health-number"><strong>{displayValue(metric, value)}</strong><span>{def.unit}</span>
          {change !== null && <small>{change >= 0 ? '+' : ''}{change.toFixed(1)}% vs prior period</small>}
        </div>
        {series.rows.length ? p.chart !== 'number' && <HealthChart metric={metric} rows={series.rows} start={window.start} end={window.end} mode={p.chart} /> : <p className="lb-health-empty">No readable data in this period.</p>}
        <div className="lb-health-foot"><span>{series.rows.length}/{days} days · {def.summary === 'sum' ? 'total' : def.summary === 'latest' ? 'latest daily value' : 'daily average'}</span><span>{series.selected || 'No source'}</span></div>
        {stale && <div className="lb-health-note">Latest observation in view: {lastDay}</div>}
      </>}
      {overview && ready && <div className="lb-health-note">Missing days stay blank. Each metric uses one source. Values update as exports arrive.</div>}
    </article>
    {isEditing && <NodeEditorPopover shape={shape} editor={editor} width={365}>
      <div className="lb-health-config">
        <h3>{overview ? 'Health overview' : def.label}</h3>
        {snapshot && !ready && <button onClick={() => patch({ datasetId: snapshot.datasetId })}>Connect to this health dataset</button>}
        <label>Period<select value={p.range} onChange={e => patch({ range: e.target.value as HealthNodeProps['range'], ...(e.target.value === 'fixed' ? { start: window.start, end: window.end } : {}) })}>
          <option value="yesterday">Yesterday</option><option value="lastWeek">Previous calendar week</option><option value="7">Last 7 complete days</option><option value="30">Last 30 complete days</option><option value="90">Last 90 complete days</option><option value="fixed">Fixed dates</option>
        </select></label>
        {p.range === 'fixed' && <div className="lb-health-config-dates"><label>From<input type="date" value={p.start || window.start} onChange={e => patch({ start: e.target.value })} /></label><label>Through<input type="date" value={p.end || window.end} onChange={e => patch({ end: e.target.value })} /></label></div>}
        {p.range !== 'fixed' && <button onClick={() => patch({ range: 'fixed', start: window.start, end: window.end })}>Pin these dates</button>}
        {p.range === 'fixed' && <p>Fixed dates still reflect corrected imports. Choose an ordered range shorter than two years.</p>}
        {!overview && <>
          <label>Visualization<select value={p.chart} onChange={e => patch({ chart: e.target.value as HealthNodeProps['chart'] })}><option value="bars">Daily bars</option><option value="line">Trend line</option><option value="heatmap">Heat strip</option><option value="number">Number</option>{metric === 'sleep' && <option value="stages">Sleep stages</option>}</select></label>
          <label>Source<select value={p.source} onChange={e => patch({ source: e.target.value })}><option value="">Automatic (only with one source)</option>{[...new Set([...series.sources, ...(p.source ? [p.source] : [])])].map(s => <option key={s}>{s}</option>)}</select></label>
          <p>{metric === 'hrv' ? 'Apple Health HRV is recorded as SDNN. The original device method may differ; compare the same source over time.' : metric.includes('Temperature') ? 'Temperature is shown as recorded. Wrist and body measurements remain separate.' : metric === 'activeEnergy' ? 'Daily active energy already includes activity. Workout calories are not added again.' : 'Daily summaries use the dates and selected sources in your export.'}</p>
          {series.rows.length > 0 && <details><summary>View daily data ({series.rows.length})</summary><table><thead><tr><th>Date</th><th>{def.unit}</th></tr></thead><tbody>{series.rows.map(r => <tr key={r.day}><td>{r.day}</td><td>{displayValue(metric, r.value)}</td></tr>)}</tbody></table></details>}
        </>}
        <button onClick={() => editor.setEditingShape(null)}>Done</button>
      </div>
    </NodeEditorPopover>}
  </>
}
