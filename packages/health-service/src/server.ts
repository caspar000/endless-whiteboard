import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import type { HealthDatabase } from './database.ts'
import type { createScanner } from './scanner.ts'

export function createHealthServer(options: {
  database: HealthDatabase
  scanner: ReturnType<typeof createScanner>
  token: string
  web?: string
  saveFolder?: (folder: string) => Promise<void>
  pickFolder?: () => Promise<string | null>
}) {
  function authenticated(req: IncomingMessage): boolean {
    const value = Buffer.from(req.headers.authorization ?? '')
    const expected = Buffer.from(`Bearer ${options.token}`)
    return value.length === expected.length && timingSafeEqual(value, expected)
  }
  function json(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    res.end(JSON.stringify(body))
  }
  async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      const bytes = Buffer.from(chunk)
      size += bytes.length
      if (size > 8_192) throw new Error('Request is too large.')
      chunks.push(bytes)
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object.')
    return value as Record<string, unknown>
  }
  return createServer(async (req, res) => {
    try {
      // Host and Origin validation prevent cross-site/DNS-rebinding access to a local service.
      const host = req.headers.host ?? ''
      if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) return json(res, 403, { error: 'Invalid host.' })
      if (req.headers.origin && req.headers.origin !== `http://${host}` && req.headers.origin !== `https://${host}`) return json(res, 403, { error: 'Invalid origin.' })
      const path = new URL(req.url ?? '/', `http://${host}`).pathname
      if (path.startsWith('/__lifeboard/health/') || path.startsWith('/health/v1/')) {
        if (!authenticated(req)) return json(res, 401, { error: 'Enter the local service access key in Health settings.' })
        const endpoint = path.replace(/^\/(?:__lifeboard\/health|health\/v1)/, '')
        if (req.method === 'GET' && endpoint === '/snapshot') return json(res, 200, { snapshot: options.database.snapshot(), status: await options.scanner.scan() })
        if (req.method === 'GET' && endpoint === '/status') return json(res, 200, options.scanner.getStatus())
        if (req.method === 'PUT' && endpoint === '/config') {
          try {
            const input = await body(req)
            if (typeof input.folder !== 'string') return json(res, 400, { error: 'Choose an export folder.' })
            const status = await options.scanner.setFolder(input.folder)
            await options.saveFolder?.(status.folder!)
            return json(res, 200, { snapshot: options.database.snapshot(), status })
          } catch (error) { return json(res, 400, { error: folderError(error) }) }
        }
        if (req.method === 'POST' && endpoint === '/pick-folder') {
          try {
            if (!options.pickFolder) return json(res, 501, { error: 'Folder selection is unavailable on this system.' })
            const folder = await options.pickFolder()
            if (!folder) return json(res, 200, { cancelled: true })
            const status = await options.scanner.setFolder(folder)
            await options.saveFolder?.(status.folder!)
            return json(res, 200, { snapshot: options.database.snapshot(), status })
          } catch (error) { return json(res, 400, { error: folderError(error) }) }
        }
        if (endpoint === '/snapshot' || endpoint === '/status') return json(res, 405, { error: 'Method not allowed.' })
        return json(res, 404, { error: 'Unknown health endpoint.' })
      }
      if (!options.web || (req.method !== 'GET' && req.method !== 'HEAD')) return json(res, 404, { error: 'Not found.' })
      const root = resolve(options.web)
      let file = resolve(root, `.${decodeURIComponent(path)}`)
      if (file !== root && !file.startsWith(`${root}${sep}`)) return json(res, 403, { error: 'Invalid path.' })
      try { if (!(await stat(file)).isFile()) file = resolve(root, 'index.html') }
      catch { file = resolve(root, 'index.html') }
      const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' }
      const data = await readFile(file)
      res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' })
      res.end(req.method === 'HEAD' ? undefined : data)
    } catch { json(res, 500, { error: 'The health service could not complete the request.' }) }
  })
}

function folderError(error: unknown): string {
  const code = (error as NodeJS.ErrnoException)?.code
  if (code === 'ENOENT') return 'That folder does not exist or is not downloaded from iCloud yet.'
  if (code === 'EACCES' || code === 'EPERM') return 'Lifeboard cannot read that folder. Check macOS file access.'
  return error instanceof Error ? error.message.slice(0, 240) : 'Could not use that export folder.'
}
