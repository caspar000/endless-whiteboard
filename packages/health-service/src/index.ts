import { mkdir, readFile, writeFile, chmod, rename } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { resolve, join } from 'node:path'
import { parseArgs } from 'node:util'
import { promisify } from 'node:util'
import { HealthDatabase } from './database.ts'
import { createScanner } from './scanner.ts'
import { createHealthServer } from './server.ts'

const { values } = parseArgs({ args: process.argv.slice(2).filter(a => a !== '--'), options: {
  folder: { type: 'string' }, 'data-dir': { type: 'string' }, port: { type: 'string', default: '8790' },
  timezone: { type: 'string' }, restore: { type: 'string' }, web: { type: 'string' }, help: { type: 'boolean' },
} })
if (values.help) {
  console.log('Usage: pnpm health [--folder "/path/to/AutoExport"] [--data-dir PATH] [--port 8790] [--timezone Asia/Tbilisi] [--restore BACKUP.json] [--web /path/to/apps/web/dist]')
  process.exit(0)
}
const port = Number(values.port)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port.')
const directory = resolve(values['data-dir'] ?? join(homedir(), '.lifeboard', 'health'))
await mkdir(directory, { recursive: true, mode: 0o700 })
await chmod(directory, 0o700)
const tokenPath = join(directory, 'token')
const settingsPath = join(directory, 'settings.json')
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
let savedFolder: string | null = null
try {
  const settings: unknown = JSON.parse(await readFile(settingsPath, 'utf8'))
  if (settings && typeof settings === 'object' && typeof (settings as { folder?: unknown }).folder === 'string') savedFolder = (settings as { folder: string }).folder
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('Health settings could not be read; choose the export folder again in Lifeboard.')
}
const initialFolder = values.folder ? resolve(values.folder) : savedFolder
async function saveFolder(folder: string) {
  const temporary = `${settingsPath}.tmp`
  await writeFile(temporary, JSON.stringify({ folder }, null, 2), { mode: 0o600 })
  await rename(temporary, settingsPath)
  await chmod(settingsPath, 0o600)
}
if (values.folder) await saveFolder(initialFolder!)
const scanner = createScanner(initialFolder, database)
await scanner.scan()
await scanner.scan()
const interval = setInterval(() => { void scanner.scan() }, 5000)
const execFileAsync = promisify(execFile)
const server = createHealthServer({
  database, scanner, token, saveFolder,
  web: values.web ? resolve(values.web) : undefined,
  pickFolder: process.platform === 'darwin' ? async () => {
    try {
      const { stdout } = await execFileAsync('/usr/bin/osascript', [
        '-e', 'tell application "Finder" to activate',
        '-e', 'POSIX path of (choose folder with prompt "Choose your Health Auto Export folder")',
      ])
      return stdout.trim().replace(/\/$/, '') || null
    } catch (error) {
      if (String((error as { stderr?: unknown }).stderr).includes('-128')) return null
      throw error
    }
  } : undefined,
})
server.listen(port, '127.0.0.1', () => console.log(`Health service ready at http://127.0.0.1:${port}${initialFolder ? `\nWatching: ${initialFolder}` : '\nChoose an export folder in Lifeboard → Settings → Extensions → Apple Health.'}\nHealth values are not logged.`))
let stopping = false
function stop() {
  if (stopping) return
  stopping = true
  clearInterval(interval)
  server.close(() => { void scanner.scan().finally(() => { database.close(); process.exit(0) }) })
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
