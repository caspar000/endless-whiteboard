import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Plugin } from 'vite'

/** Local dev only. Credentials stay on the server; no key is bundled into the web app. */
export function healthProxyPlugin(): Plugin {
  return {
    name: 'lifeboard:health-proxy', apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__lifeboard/health', async (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'no-store')
        const reject = (status: number, error: string) => { res.statusCode = status; res.end(JSON.stringify({ error })) }
        const host = req.headers.host ?? ''
        if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) return reject(403, 'Health dev proxy is available only on localhost.')
        if (req.headers.origin && req.headers.origin !== `http://${host}`) return reject(403, 'Invalid origin.')
        if (req.method !== 'GET' || !['/snapshot', '/status'].includes((req.url ?? '').split('?')[0]!)) return reject(404, 'Unknown health endpoint.')
        try {
          const directory = process.env.LIFEBOARD_HEALTH_DATA_DIR ?? join(homedir(), '.lifeboard', 'health')
          const token = (await readFile(join(directory, 'token'), 'utf8')).trim()
          const port = Number(process.env.LIFEBOARD_HEALTH_PORT ?? 8790)
          if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port')
          const upstream = await fetch(`http://127.0.0.1:${port}/health/v1${req.url}`, {
            headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000),
          })
          res.statusCode = upstream.status
          res.end(await upstream.text())
        } catch { reject(503, 'Start the local health service with your iCloud export folder. Cached readings remain available.') }
      })
    },
  }
}
