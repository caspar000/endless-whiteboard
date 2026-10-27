import { chromium } from '@playwright/test'
const out = '/tmp/zk/p5'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme: 'dark' })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
await page.goto('http://127.0.0.1:4100'); await page.waitForTimeout(2500)
await page.getByRole('button', { name: 'All boards' }).first().click(); await page.waitForTimeout(600)
await page.getByRole('button', { name: 'New box' }).first().click(); await page.waitForTimeout(1500)
await page.getByRole('button', { name: 'Collapse sidebar' }).first().click().catch(() => {})
// Build a bigger box through the editor: 40 notes in 6 trains with some links, made the way placeNote does.
await page.getByRole('button', { name: 'Write the first note' }).first().click(); await page.waitForTimeout(350)
await page.keyboard.type('# Society\nWhat a society is.'); await page.keyboard.press('Escape'); await page.waitForTimeout(250)
const titles = ['Communication', 'Systems', 'Autopoiesis', 'Observation', 'Meaning', 'Power', 'Money', 'Love', 'Law', 'Art', 'Science', 'Religion', 'Media', 'Education', 'Politics']
let i = 0
for (const t of titles) {
  const key = i % 4 === 3 ? 'N' : 'n'
  await page.keyboard.press(key); await page.waitForTimeout(300)
  await page.keyboard.type(`# ${t}\nOn ${t.toLowerCase()}.` + (i % 3 === 0 ? ' See [[1]].' : i % 5 === 0 ? ' See [[2]].' : ''))
  await page.keyboard.press('Escape'); await page.waitForTimeout(200)
  if (i % 5 === 4) { await page.getByRole('button', { name: 'New train of thought' }).click(); await page.waitForTimeout(300); await page.keyboard.type(`# Train ${i}\nA new start.`); await page.keyboard.press('Escape'); await page.waitForTimeout(200) }
  i++
}
await page.locator('.lb-zstack__front .lb-zchip--add').click(); await page.keyboard.type('Systems theory'); await page.keyboard.press('Enter'); await page.waitForTimeout(200)
await page.keyboard.press('g'); await page.waitForTimeout(1600)
await page.screenshot({ path: `${out}/1-graph.png` })
// hover a dot via the accessible list's knowledge: find a node by scanning
const box = await page.locator('.lb-zgraph__canvas').boundingBox()
let found = false
for (let y = 100; y < 800 && !found; y += 6) for (let x = 200; x < 1300 && !found; x += 6) {
  await page.mouse.move(x, y)
  if (await page.locator('.lb-zgraph__hint').count()) found = true
}
await page.waitForTimeout(200)
await page.screenshot({ path: `${out}/2-hover.png` })
await page.keyboard.press(' '); await page.waitForTimeout(300)
await page.screenshot({ path: `${out}/3-peek.png` })
await page.keyboard.press('Escape')
await page.getByRole('button', { name: 'Keywords', exact: true }).click(); await page.getByRole('button', { name: 'Sources', exact: true }).click(); await page.waitForTimeout(1200)
await page.mouse.move(700, 450); await page.mouse.wheel(0, -500); await page.waitForTimeout(400)
await page.screenshot({ path: `${out}/4-zoomed.png` })
await page.emulateMedia({ colorScheme: 'light' }); await page.keyboard.press('0'); await page.waitForTimeout(400)
await page.screenshot({ path: `${out}/5-light.png` })
await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(600)
await page.screenshot({ path: `${out}/6-phone.png` })
console.log('errors', errors)
await browser.close()
