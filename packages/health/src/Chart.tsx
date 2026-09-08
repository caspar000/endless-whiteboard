import { daysIn, displayValue, METRICS, type DailyRecord, type Metric } from '@lifeboard/health-core'

/** Gaps are gaps: lines never bridge a day for which the exporter has no value. */
export function HealthChart({ metric, rows, start, end, mode }: {
  metric: Metric; rows: DailyRecord[]; start: string; end: string; mode: string
}) {
  const dates = daysIn(start, end)
  const byDay = new Map(rows.map(r => [r.day, r]))
  const points = dates.map(day => byDay.get(day))
  const width = 300, height = 100, top = 12, bottom = 85
  const step = width / Math.max(dates.length, 1)
  const max = Math.max(...rows.map(r => r.value), 1)
  const min = mode === 'line' ? Math.min(...rows.map(r => r.value), max) : 0
  const spread = max === min ? Math.max(max * 0.1, 1) : max - min
  const y = (value: number) => bottom - (value - min) / spread * (bottom - top)
  const color = METRICS[metric].color
  return <div className="lb-health-chart">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${METRICS[metric].label}, ${start} to ${end}; ${rows.length} observed days. Double-click the card for a data table.`}>
      <line x1="0" x2={width} y1={bottom} y2={bottom} stroke="currentColor" opacity="0.12" />
      {mode !== 'heatmap' && <text x="0" y="9" fill="currentColor" opacity="0.55" fontSize="8">{displayValue(metric, max)} {METRICS[metric].unit}</text>}
      {points.map((row, i) => {
        const x = i * step + step / 2
        if (!row) return mode === 'heatmap' ? <rect key={dates[i]} x={i * step + 1} y="35" width={Math.max(step - 2, 1)} height="25" fill="currentColor" opacity="0.06" /> : null
        const title = `${row.day}: ${displayValue(metric, row.value)} ${METRICS[metric].unit}`
        if (mode === 'line') return <g key={row.day}><title>{title}</title>
          {points[i - 1] && <line x1={x - step} y1={y(points[i - 1]!.value)} x2={x} y2={y(row.value)} stroke={color} strokeWidth="2" />}
          <circle cx={x} cy={y(row.value)} r={dates.length > 40 ? 1.8 : 3} fill={color} />
        </g>
        if (mode === 'heatmap') return <rect key={row.day} x={i * step + 1} y="35" width={Math.max(step - 2, 1)} height="25" rx="2" fill={color} opacity={0.15 + 0.85 * row.value / max}><title>{title}</title></rect>
        if (mode === 'stages' && metric === 'sleep' && row.stages) {
          const stages = [row.stages.deep, row.stages.core, row.stages.rem, Math.max(0, row.value - row.stages.deep - row.stages.core - row.stages.rem)]
          let offset = 0
          return <g key={row.day}><title>{title}; deep {displayValue('sleep', stages[0]!)} h, core {displayValue('sleep', stages[1]!)} h, REM {displayValue('sleep', stages[2]!)} h</title>{stages.map((value, j) => {
            const h = value / max * (bottom - top)
            offset += h
            return <rect key={j} x={i * step + 2} y={bottom - offset} width={Math.max(step - 4, 1)} height={h} fill={['#7473bc', '#aaa0e8', '#d8c4f1', '#696879'][j]} />
          })}</g>
        }
        return <rect key={row.day} x={i * step + 2} y={y(row.value)} width={Math.max(step - 4, 1)} height={Math.max(bottom - y(row.value), 1)} rx="2" fill={color}><title>{title}</title></rect>
      })}
    </svg>
    <div className="lb-health-axis"><span>{start.slice(5)}</span><span>{end.slice(5)}</span></div>
    {mode === 'stages' && <div className="lb-health-axis"><span>Deep · Core · REM · Unspecified</span></div>}
  </div>
}
