import { readFile } from 'node:fs/promises'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

/** Local dev only. Credentials stay on the server; no key is bundled into the web app. */
export function healthProxyPlugin(): Plugin {
  let child: ChildProcess | null = null
  const directory = process.env.LIFEBOARD_HEALTH_DATA_DIR ?? join(homedir(), '.lifeboard', 'health')
  const preferredPort = Number(process.env.LIFEBOARD_HEALTH_PORT ?? 8790)
  let port = preferredPort
  async function available(candidate = port) {
    try {
      const token = (await readFile(join(directory, 'token'), 'utf8')).trim()
      const response = await fetch(`http://127.0.0.1:${candidate}/health/v1/status`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(500) })
      if (!response.ok) return false
      const status: unknown = await response.json()
      return !!status && typeof status === 'object' && 'folder' in status && typeof (status as { incompatible?: unknown }).incompatible === 'number'
    } catch { return false }
  }
  async function choosePort(candidate: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const reservation = createServer()
      reservation.unref()
      reservation.once('error', error => {
        if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') return reject(error)
        const fallback = createServer()
        fallback.unref()
        fallback.once('error', reject)
        fallback.listen(0, '127.0.0.1', () => {
          const address = fallback.address()
          const selected = address && typeof address === 'object' ? address.port : 0
          fallback.close(closeError => closeError ? reject(closeError) : resolve(selected))
        })
      })
      reservation.listen(candidate, '127.0.0.1', () => reservation.close(error => error ? reject(error) : resolve(candidate)))
    })
  }
  async function ensureService() {
    if (!Number.isInteger(preferredPort) || preferredPort < 1 || preferredPort > 65535) throw new Error('Invalid LIFEBOARD_HEALTH_PORT.')
    if (await available(preferredPort)) { port = preferredPort; return }
    port = await choosePort(preferredPort)
    const entry = fileURLToPath(new URL('../../../packages/health-service/src/index.ts', import.meta.url))
    child = spawn(process.execPath, [entry, '--data-dir', directory, '--port', String(port)], { stdio: 'inherit' })
    let startupError: Error | null = null
    child.once('error', error => { startupError = error })
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await available()) return
      if (startupError) throw startupError
      if (child.exitCode !== null) throw new Error('The health service stopped during startup.')
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (child.exitCode === null) child.kill('SIGTERM')
    throw new Error('The health service did not start in time.')
  }
  return {
    name: 'lifeboard:health-proxy', apply: 'serve',
    configureServer(server) {
      const serviceReady = ensureService()
      server.httpServer?.once('close', () => { if (child && child.exitCode === null) child.kill('SIGTERM') })
      server.middlewares.use('/__lifeboard/health', async (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'no-store')
        const reject = (status: number, error: string) => { res.statusCode = status; res.end(JSON.stringify({ error })) }
        const host = req.headers.host ?? ''
        if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) return reject(403, 'Health dev proxy is available only on localhost.')
        if (req.headers.origin && req.headers.origin !== `http://${host}`) return reject(403, 'Invalid origin.')
        const path = (req.url ?? '').split('?')[0]!
        const allowed = req.method === 'GET' && ['/snapshot', '/status'].includes(path) || req.method === 'PUT' && path === '/config' || req.method === 'POST' && path === '/pick-folder'
        if (!allowed) return reject(404, 'Unknown health endpoint.')
        try {
          await serviceReady
          const token = (await readFile(join(directory, 'token'), 'utf8')).trim()
          const chunks: Buffer[] = []
          let size = 0
          if (req.method !== 'GET') for await (const chunk of req) {
            const bytes = Buffer.from(chunk)
            size += bytes.length
            if (size > 8_192) return reject(413, 'Request is too large.')
            chunks.push(bytes)
          }
          const upstream = await fetch(`http://127.0.0.1:${port}/health/v1${req.url}`, {
            method: req.method,
            headers: { authorization: `Bearer ${token}`, ...(req.headers['content-type'] ? { 'content-type': req.headers['content-type'] } : {}) },
            ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
            signal: AbortSignal.timeout(60_000),
          })
          res.statusCode = upstream.status
          res.end(await upstream.text())
        } catch { reject(503, 'The local health service could not start. Cached readings remain available.') }
      })
    },
  }
}
