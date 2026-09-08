/** Daily Health Auto Export records. Raw samples and daily buckets are deliberately not mixed. */
export const METRICS = {
  steps: { label: 'Steps', unit: 'steps', summary: 'sum', color: '#6ac4a2' },
  activeEnergy: { label: 'Active energy', unit: 'kcal', summary: 'sum', color: '#e8a575' },
  basalEnergy: { label: 'Resting energy', unit: 'kcal', summary: 'sum', color: '#d1ad80' },
  sleep: { label: 'Sleep', unit: 'h', summary: 'mean', color: '#a49fe5' },
  weight: { label: 'Weight', unit: 'kg', summary: 'latest', color: '#88b8d9' },
  hrv: { label: 'Heart rate variability', unit: 'ms', summary: 'mean', color: '#c0a6df' },
  restingHeartRate: { label: 'Resting heart rate', unit: 'bpm', summary: 'mean', color: '#df969d' },
  heartRate: { label: 'Heart rate', unit: 'bpm', summary: 'mean', color: '#e29d9d' },
  wristTemperature: { label: 'Sleeping wrist temperature', unit: '°C', summary: 'mean', color: '#d7ad82' },
  bodyTemperature: { label: 'Body temperature', unit: '°C', summary: 'mean', color: '#d7ad82' },
  oxygen: { label: 'Blood oxygen', unit: '%', summary: 'mean', color: '#85b7d7' },
  respiratoryRate: { label: 'Respiratory rate', unit: 'breaths/min', summary: 'mean', color: '#84c0c0' },
} as const

export type Metric = keyof typeof METRICS
export const METRIC_KEYS = Object.keys(METRICS) as Metric[]
export const MAX_RECORDS = 100_000
export const MAX_FILE_BYTES = 20 * 1024 * 1024
export interface DailyRecord {
  metric: Metric
  day: string
  source: string
  value: number
  /** Original export timestamp/offset; daily buckets keep the export's date. */
  timestamp: string
  /** Seconds internally. Stages exclude awake/in-bed; null means unavailable. */
  stages: { core: number; deep: number; rem: number } | null
}
export interface HealthSnapshot {
  version: 1
  datasetId: string
  revision: number
  timezone: string
  importedAt: string | null
  records: DailyRecord[]
}
export interface ImportResult { records: DailyRecord[]; ignored: string[] }

const NAMES: Record<string, Metric> = {
  step_count: 'steps', active_energy: 'activeEnergy', active_energy_burned: 'activeEnergy',
  basal_energy_burned: 'basalEnergy', basal_energy: 'basalEnergy', resting_energy: 'basalEnergy',
  sleep_analysis: 'sleep', 'weight_&_body_mass': 'weight', weight_body_mass: 'weight', body_mass: 'weight', weight: 'weight',
  heart_rate_variability: 'hrv', heart_rate_variability_sdnn: 'hrv',
  resting_heart_rate: 'restingHeartRate', heart_rate: 'heartRate',
  apple_sleeping_wrist_temperature: 'wristTemperature', body_temperature: 'bodyTemperature',
  blood_oxygen_saturation: 'oxygen', oxygen_saturation: 'oxygen', respiratory_rate: 'respiratoryRate',
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object.')
  return value as Record<string, unknown>
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Expected a finite numeric value.')
  return value
}
export function isDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}
export function recordKey(row: Pick<DailyRecord, 'metric' | 'day' | 'source'>): string {
  return JSON.stringify([row.metric, row.day, row.source])
}
function convert(metric: Metric, unit: string, value: number): number {
  const u = unit.toLowerCase().replace(/\s/g, '')
  if (metric === 'weight') {
    if (u === 'kg') return value
    if (u === 'lb' || u === 'lbs') return value * 0.45359237
    if (u === 'g') return value / 1000
  } else if (metric === 'activeEnergy' || metric === 'basalEnergy') {
    if (u === 'kcal') return value
    if (u === 'kj') return value / 4.184
  } else if (metric === 'sleep') {
    if (['hr', 'hrs', 'h', 'hours'].includes(u)) return value * 3600
    if (['min', 'minutes'].includes(u)) return value * 60
    if (['s', 'sec', 'seconds'].includes(u)) return value
  } else if (metric === 'hrv') {
    if (u === 'ms') return value
    if (u === 's') return value * 1000
  } else if (metric === 'bodyTemperature' || metric === 'wristTemperature') {
    if (['degc', '°c', 'c'].includes(u)) return value
    if (['degf', '°f', 'f'].includes(u)) return (value - 32) * 5 / 9
  } else if (metric === 'oxygen') {
    if (u === '%') return value
    if (u === 'count' || u === 'fraction') return value * 100
  } else if (metric === 'steps' && ['count', 'steps'].includes(u)) return value
  else if (['heartRate', 'restingHeartRate'].includes(metric) && ['bpm', 'count/min'].includes(u)) return value
  else if (metric === 'respiratoryRate' && ['count/min', 'breaths/min'].includes(u)) return value
  throw new Error(`Unsupported unit “${unit}” for ${METRICS[metric].label}.`)
}

/** Accepts the documented data.metrics envelope and a standalone metrics object. */
export function parseAutoExport(input: unknown): ImportResult {
  const root = object(input)
  const body = root.data === undefined ? root : object(root.data)
  if (!Array.isArray(body.metrics)) throw new Error('This is not a Health Auto Export metrics JSON file.')
  const records: DailyRecord[] = []
  const seen = new Set<string>()
  const ignored = new Set<string>()
  for (const entry of body.metrics) {
    const group = object(entry)
    const name = typeof group.name === 'string' ? group.name : ''
    const metric = Object.hasOwn(NAMES, name) ? NAMES[name] : undefined
    if (!metric) { ignored.add(name.slice(0, 100) || 'Unnamed metric'); continue }
    if (!Array.isArray(group.data) || typeof group.units !== 'string') throw new Error(`Invalid ${name} data.`)
    for (const raw of group.data) {
      const point = object(raw)
      const timestamp = typeof point.date === 'string' ? point.date : ''
      const day = timestamp.slice(0, 10)
      if (!isDay(day) || (timestamp.length > 10 && !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?: ?[+-]\d{2}:?\d{2}|Z)$/.test(timestamp))) {
        throw new Error(`${METRICS[metric].label}: expected a dated daily summary. Choose daily time grouping and aggregated sleep in Health Auto Export.`)
      }
      const source = typeof point.source === 'string' && point.source.trim() ? point.source.trim() : 'Export selection'
      if (source.length > 256) throw new Error('Source name is too long.')
      let stages: DailyRecord['stages'] = null
      const value = convert(metric, group.units, number(metric === 'sleep' ? point.totalSleep ?? point.asleep : metric === 'heartRate' ? point.Avg ?? point.qty : point.qty))
      if (!Number.isFinite(value)) throw new Error('Converted health value is not finite.')
      if (value < 0 && !['bodyTemperature', 'wristTemperature'].includes(metric)) throw new Error(`Negative ${METRICS[metric].label} value.`)
      if (metric === 'sleep' && ['core', 'deep', 'rem'].every(key => typeof point[key] === 'number')) {
        stages = {
          core: convert(metric, group.units, number(point.core)),
          deep: convert(metric, group.units, number(point.deep)),
          rem: convert(metric, group.units, number(point.rem)),
        }
        if (Object.values(stages).some(v => v < 0) || Object.values(stages).reduce((a, b) => a + b, 0) > value + 60) {
          throw new Error('Sleep stages are inconsistent with total sleep.')
        }
      }
      const row: DailyRecord = { metric, day, source, timestamp, value, stages }
      const key = recordKey(row)
      if (seen.has(key)) throw new Error(`${METRICS[metric].label} has several records for ${day}. Export one daily summary per source; hourly/raw samples cannot be added safely.`)
      seen.add(key)
      records.push(row)
      if (records.length > MAX_RECORDS) throw new Error('Too many daily records. Export a smaller date range.')
    }
  }
  return { records, ignored: [...ignored] }
}

/** Validate caches/service responses/backups before any health value reaches a chart. */
export function parseSnapshot(input: unknown): HealthSnapshot {
  const value = object(input)
  if (value.version !== 1 || typeof value.datasetId !== 'string' || !value.datasetId || value.datasetId.length > 100 ||
      !Number.isSafeInteger(value.revision) || (value.revision as number) < 0 || typeof value.timezone !== 'string' ||
      !(value.importedAt === null || typeof value.importedAt === 'string' && Number.isFinite(Date.parse(value.importedAt))) ||
      !Array.isArray(value.records) || value.records.length > MAX_RECORDS) throw new Error('Invalid health snapshot.')
  new Intl.DateTimeFormat('en', { timeZone: value.timezone })
  const seen = new Set<string>()
  const records = value.records.map(inputRow => {
    const r = object(inputRow)
    if (typeof r.metric !== 'string' || !Object.hasOwn(METRICS, r.metric) || typeof r.day !== 'string' || !isDay(r.day) ||
        typeof r.source !== 'string' || !r.source || r.source.length > 256 || typeof r.timestamp !== 'string' || r.timestamp.length > 100) throw new Error('Invalid daily health record.')
    const metric = r.metric as Metric
    const v = number(r.value)
    if (v < 0 && !['bodyTemperature', 'wristTemperature'].includes(metric)) throw new Error('Invalid negative health value.')
    let stages: DailyRecord['stages'] = null
    if (r.stages !== null) {
      const s = object(r.stages)
      stages = { core: number(s.core), deep: number(s.deep), rem: number(s.rem) }
      if (metric !== 'sleep' || Object.values(stages).some(n => n < 0) || Object.values(stages).reduce((a, b) => a + b, 0) > v + 60) throw new Error('Invalid sleep stages.')
    }
    const row: DailyRecord = { metric, day: r.day, source: r.source, timestamp: r.timestamp, value: v, stages }
    const key = recordKey(row)
    if (seen.has(key)) throw new Error('Duplicate daily health record.')
    seen.add(key)
    return row
  })
  return { version: 1, datasetId: value.datasetId, revision: value.revision as number, timezone: value.timezone, importedAt: value.importedAt as string | null, records }
}

export function shiftDay(day: string, offset: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}
export function todayIn(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}
export function dateWindow(range: string, today: string, start = '', end = ''): { start: string; end: string } {
  if (range === 'fixed' && isDay(start) && isDay(end) && start <= end && (Date.parse(end) - Date.parse(start)) / 86400000 < 730) return { start, end }
  if (range === 'lastWeek') {
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay()
    const monday = shiftDay(today, -((weekday + 6) % 7))
    return { start: shiftDay(monday, -7), end: shiftDay(monday, -1) }
  }
  const count = range === '7' ? 7 : range === '90' ? 90 : range === 'yesterday' ? 1 : 30
  return { start: shiftDay(today, -count), end: shiftDay(today, -1) }
}
export function daysIn(start: string, end: string): string[] {
  if (!isDay(start) || !isDay(end) || start > end) return []
  const days: string[] = []
  for (let d = start; d <= end && days.length < 730; d = shiftDay(d, 1)) days.push(d)
  return days
}
export function selectSeries(records: readonly DailyRecord[], metric: Metric, start: string, end: string, source = '') {
  const candidates = records.filter(r => r.metric === metric && r.day >= start && r.day <= end)
  const sources = [...new Set(candidates.map(r => r.source))].sort()
  const selected = source || (sources.length === 1 ? sources[0]! : '')
  const rows = candidates.filter(r => r.source === selected).sort((a, b) => a.day.localeCompare(b.day))
  return { sources, selected, rows, ambiguous: !source && sources.length > 1 }
}
export function summarize(metric: Metric, rows: readonly DailyRecord[]): number | null {
  if (!rows.length) return null
  if (METRICS[metric].summary === 'latest') return rows[rows.length - 1]!.value
  const total = rows.reduce((n, r) => n + r.value, 0)
  return METRICS[metric].summary === 'sum' ? total : total / rows.length
}
export function displayValue(metric: Metric, value: number | null): string {
  if (value === null) return '—'
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: metric === 'steps' ? 0 : 1 }).format(metric === 'sleep' ? value / 3600 : value)
}
