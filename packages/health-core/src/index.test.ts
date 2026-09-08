import { describe, expect, it } from 'vitest'
import { dateWindow, displayValue, parseAutoExport, parseSnapshot, selectSeries, summarize, todayIn } from './index.ts'

const file = (name: string, units: string, data: unknown[]) => ({ data: { metrics: [{ name, units, data }] } })
describe('daily Apple Health imports', () => {
  it('keeps the exported calendar date and source, including timezone boundaries', () => {
    const result = parseAutoExport(file('step_count', 'count', [{ date: '2026-09-01 00:00:00 +0400', qty: 7123, source: 'Zepp' }]))
    expect(result.records[0]).toMatchObject({ metric: 'steps', day: '2026-09-01', value: 7123, source: 'Zepp' })
    expect(todayIn('Asia/Tbilisi', new Date('2026-08-31T21:00:00Z'))).toBe('2026-09-01')
  })
  it('does not add hourly records or competing sources together', () => {
    expect(() => parseAutoExport(file('step_count', 'count', [
      { date: '2026-09-01 10:00:00 +0400', qty: 100 }, { date: '2026-09-01 11:00:00 +0400', qty: 200 },
    ]))).toThrow('daily summary')
    const { records } = parseAutoExport(file('step_count', 'count', [
      { date: '2026-09-01', qty: 100, source: 'Zepp' }, { date: '2026-09-01', qty: 120, source: 'iPhone' },
    ]))
    expect(selectSeries(records, 'steps', '2026-09-01', '2026-09-07')).toMatchObject({ rows: [], ambiguous: true })
    expect(summarize('steps', selectSeries(records, 'steps', '2026-09-01', '2026-09-07', 'Zepp').rows)).toBe(100)
  })
  it('uses totalSleep once, excluding in-bed and nested stage totals', () => {
    const { records } = parseAutoExport(file('sleep_analysis', 'hr', [{ date: '2026-09-01', totalSleep: 7.5, asleep: 7.5, inBed: 9, core: 4, deep: 1, rem: 2 }]))
    expect(records[0]).toMatchObject({ value: 27000, stages: { core: 14400, deep: 3600, rem: 7200 } })
    expect(displayValue('sleep', summarize('sleep', records))).toBe('7.5')
    expect(() => parseAutoExport(file('sleep_analysis', 'hr', [{ date: '2026-09-01', totalSleep: 5, core: 4, deep: 1, rem: 2 }]))).toThrow('inconsistent')
  })
  it('normalizes units and special heart rate summaries without inventing RHR', () => {
    expect(parseAutoExport(file('weight_&_body_mass', 'lb', [{ date: '2026-09-01', qty: 200 }])).records[0]!.value).toBeCloseTo(90.718474)
    expect(parseAutoExport(file('heart_rate', 'count/min', [{ date: '2026-09-01', Min: 50, Avg: 65, Max: 130 }])).records[0]).toMatchObject({ metric: 'heartRate', value: 65 })
    expect(parseAutoExport(file('apple_sleeping_wrist_temperature', 'degF', [{ date: '2026-09-01', qty: 95 }])).records[0]!.value).toBeCloseTo(35)
    expect(() => parseAutoExport(file('heart_rate_variability', 'rmssd', [{ date: '2026-09-01', qty: 40 }]))).toThrow('Unsupported unit')
  })
  it('rejects malformed known metrics and reports unsupported types without retaining their values', () => {
    expect(() => parseAutoExport(file('step_count', 'count', [{ date: '2026-02-30', qty: 42 }]))).toThrow()
    expect(() => parseAutoExport(file('step_count', 'count', [{ date: '2026-09-01', qty: null }]))).toThrow()
    expect(() => parseAutoExport(file('step_count', 'count', [{ date: '2026-09-01', qty: -1 }]))).toThrow()
    expect(parseAutoExport(file('pai', 'score', [{ private: 'not retained' }]))).toEqual({ records: [], ignored: ['pai'] })
  })
  it('treats missing values as missing and weights as latest measurements', () => {
    const { records } = parseAutoExport(file('body_mass', 'kg', [{ date: '2026-08-01', qty: 75 }, { date: '2026-08-15', qty: 74 }]))
    expect(summarize('weight', records)).toBe(74)
    expect(summarize('steps', [])).toBeNull()
    const series = selectSeries(records, 'weight', '2026-08-01', '2026-08-31')
    expect(series.rows).toHaveLength(2)
  })
  it('validates backup records and rejects duplicate daily identities', () => {
    const rows = parseAutoExport(file('step_count', 'count', [{ date: '2026-09-01', qty: 0 }])).records
    const snapshot = { version: 1, datasetId: 'test', revision: 1, timezone: 'Asia/Tbilisi', importedAt: null, records: rows }
    expect(parseSnapshot(snapshot)).toEqual(snapshot)
    expect(() => parseSnapshot({ ...snapshot, records: [...rows, ...rows] })).toThrow('Duplicate')
    expect(() => parseSnapshot({ ...snapshot, timezone: 'not-a-zone' })).toThrow()
  })
  it('distinguishes a completed calendar week from a trailing window across DST', () => {
    expect(dateWindow('lastWeek', '2026-03-11')).toEqual({ start: '2026-03-02', end: '2026-03-08' })
    expect(dateWindow('7', '2026-03-11')).toEqual({ start: '2026-03-04', end: '2026-03-10' })
    expect(dateWindow('lastWeek', '2026-09-07')).toEqual({ start: '2026-08-31', end: '2026-09-06' })
  })
})
