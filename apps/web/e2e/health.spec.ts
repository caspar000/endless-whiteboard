import { expect, test } from '@playwright/test'
import { mkdtemp, mkdir, rm, writeFile, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dateWindow, daysIn, todayIn } from '@lifeboard/health-core'
import { HealthDatabase } from '../../../packages/health-service/src/database.ts'
import { createScanner } from '../../../packages/health-service/src/scanner.ts'
import { createHealthServer } from '../../../packages/health-service/src/server.ts'
import { backToList, createBoard, gotoFresh, openSettings, skipFirstRunDemo, waitForPersistedShapes } from './helpers'

test('daily export → SQLite → HTTP → cards, correction, and offline reload', async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'lifeboard-health-e2e-'))
  const folder = join(directory, 'exports'); await mkdir(folder)
  const database = new HealthDatabase(join(directory, 'health.sqlite'), 'Asia/Tbilisi')
  const scanner = createScanner(folder, database)
  const window = dateWindow('lastWeek', todayIn('Asia/Tbilisi'))
  const dates = daysIn(window.start, window.end)
  const payload = { data: { metrics: [
    { name: 'step_count', units: 'count', data: dates.map(date => ({ date, qty: 6000, source: 'Zepp' })) },
    { name: 'sleep_analysis', units: 'hr', data: dates.map(date => ({ date, totalSleep: 7.5, core: 4, deep: 1, rem: 2, source: 'Zepp' })) },
  ] } }
  async function save(age: number) {
    const path = join(folder, 'daily.json')
    await writeFile(path, JSON.stringify(payload))
    const stamp = new Date(Date.now() - age); await utimes(path, stamp, stamp)
    await scanner.scan(); await scanner.scan()
  }
  await save(20000)
  const server = createHealthServer({ database, scanner, token: 'e2e-local-token' })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  // The production preview has no dev proxy. Relay to the real service with the same server-held
  // authentication as that proxy; parsing, SQLite, HTTP, browser caching and cards remain real.
  await page.route('**/__lifeboard/health/snapshot', async route => {
    const response = await page.request.get(`http://127.0.0.1:${port}/health/v1/snapshot`, { headers: { authorization: 'Bearer e2e-local-token' } })
    await route.fulfill({ status: response.status(), contentType: 'application/json', body: await response.text() })
  })
  try {
    await gotoFresh(page)
    await skipFirstRunDemo(page)
    await openSettings(page, 'Extensions')
    await page.getByRole('button', { name: 'Apple Health', exact: true }).click()
    await expect(page.getByText('Connected to the local service.', { exact: false })).toBeVisible()
    await expect(page.getByText('14 daily records available offline.', { exact: false })).toBeVisible()
    await backToList(page)
    await createBoard(page)
    await page.keyboard.press('ControlOrMeta+k')
    await page.locator('.lb-palette__input').fill('> Create Apple Health dashboard')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('health-overview')).toBeVisible()
    const steps = page.getByTestId('health-steps')
    await expect(steps.locator('.lb-health-number strong')).toHaveText('42,000')
    await expect(page.getByTestId('health-sleep').locator('.lb-health-number strong')).toHaveText('7.5')
    await expect(page.getByTestId('health-hrv').getByText('No readable data in this period.')).toBeVisible()
    // tldraw hit-tests shapes through its canvas, rather than the pointer-inert article DOM.
    const bounds = await steps.boundingBox()
    expect(bounds).not.toBeNull()
    await page.mouse.dblclick(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2)
    await expect(page.getByRole('combobox', { name: 'Visualization', exact: true })).toBeVisible()
    await page.getByRole('combobox', { name: 'Visualization', exact: true }).selectOption('line')
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    payload.data.metrics[0]!.data[0] = { date: dates[0]!, qty: 7000, source: 'Zepp' }
    await save(5000)
    await page.keyboard.press('ControlOrMeta+k')
    await page.locator('.lb-palette__input').fill('> Refresh Apple Health history')
    await page.keyboard.press('Enter')
    await expect(steps.locator('.lb-health-number strong')).toHaveText('43,000')
    await waitForPersistedShapes(page, 7)
    await page.screenshot({ path: '/tmp/lifeboard-health-dashboard.png' })
    await page.unroute('**/__lifeboard/health/snapshot')
    await page.route('**/__lifeboard/health/snapshot', route => route.abort())
    await page.reload()
    await expect(page.getByTestId('health-steps').locator('.lb-health-number strong')).toHaveText('43,000')
    await expect(page.getByTestId('health-steps')).toContainText('OFFLINE CACHE')
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    database.close()
    await rm(directory, { recursive: true, force: true })
  }
})
