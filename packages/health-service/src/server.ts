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
  return createServer(async (req, res) => {
    try {
      // Host and Origin validation prevent cross-site/DNS-rebinding access to a local service.
      const host = req.headers.host ?? ''
      if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) return json(res, 403, { error: 'Invalid host.' })
      if (req.headers.origin && req.headers.origin !== `http://${host}` && req.headers.origin !== `https://${host}`) return json(res, 403, { error: 'Invalid origin.' })
      const path = new URL(req.url ?? '/', `http://${host}`).pathname
      if (path.startsWith('/__lifeboard/health/') || path.startsWith('/health/v1/')) {
        if (!authenticated(req)) return json(res, 401, { error: 'Enter the local service access key in Health settings.' })
        if (req.method !== 'GET') return json(res, 405, { error: 'Only read requests are supported.' })
        if (path.endsWith('/snapshot')) return json(res, 200, { snapshot: options.database.snapshot(), status: options.scanner.getStatus() })
        if (path.endsWith('/status')) return json(res, 200, options.scanner.getStatus())
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
