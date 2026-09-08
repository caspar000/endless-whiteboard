import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { resolve, join } from 'node:path'
import { parseArgs } from 'node:util'
import { HealthDatabase } from './database.ts'
import { createScanner } from './scanner.ts'
import { createHealthServer } from './server.ts'

const { values } = parseArgs({ args: process.argv.slice(2).filter(a => a !== '--'), options: {
  folder: { type: 'string' }, 'data-dir': { type: 'string' }, port: { type: 'string', default: '8790' },
  timezone: { type: 'string' }, restore: { type: 'string' }, web: { type: 'string' }, help: { type: 'boolean' },
} })
if (values.help || !values.folder) {
  console.log('Usage: pnpm health --folder "/path/to/iCloud Drive/AutoExport/Lifeboard" [--data-dir PATH] [--port 8790] [--timezone Asia/Tbilisi] [--restore BACKUP.json] [--web /path/to/apps/web/dist]')
  process.exit(values.help ? 0 : 1)
}
const port = Number(values.port)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port.')
const directory = resolve(values['data-dir'] ?? join(homedir(), '.lifeboard', 'health'))
await mkdir(directory, { recursive: true, mode: 0o700 })
await chmod(directory, 0o700)
const tokenPath = join(directory, 'token')
let token: string
try { token = (await readFile(tokenPath, 'utf8')).trim() }
catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  token = randomBytes(32).toString('hex')
  await writeFile(tokenPath, token, { mode: 0o600, flag: 'wx' })
}
if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid service token file.')
await chmod(tokenPath, 0o600)
const database = new HealthDatabase(join(directory, 'health.sqlite'), values.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone)
if (values.restore) database.restore(JSON.parse(await readFile(resolve(values.restore), 'utf8')))
const scanner = createScanner(resolve(values.folder), database)
await scanner.scan()
const interval = setInterval(() => { void scanner.scan() }, 5000)
const server = createHealthServer({ database, scanner, token, web: values.web ? resolve(values.web) : undefined })
server.listen(port, '127.0.0.1', () => console.log(`Health service: http://127.0.0.1:${port}\nAccess key file: ${tokenPath}\nWatching daily JSON exports; health values are not logged.`))
let stopping = false
function stop() {
  if (stopping) return
  stopping = true
  clearInterval(interval)
  server.close(() => { void scanner.scan().finally(() => { database.close(); process.exit(0) }) })
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
