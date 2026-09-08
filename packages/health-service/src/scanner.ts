import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { MAX_FILE_BYTES, parseAutoExport, UnsupportedExportGranularityError } from '@lifeboard/health-core'
import type { HealthDatabase } from './database.ts'

export interface ScanStatus {
  scanning: boolean
  folder: string | null
  checkedAt: string | null
  files: number
  changed: number
  incompatible: number
  errors: string[]
  ignored: string[]
}
export function createScanner(initialFolder: string | null, database: HealthDatabase) {
  let folder = initialFolder ? resolve(initialFolder) : null
  let status: ScanStatus = { scanning: false, folder, checkedAt: null, files: 0, changed: 0, incompatible: 0, errors: [], ignored: [] }
  let running: Promise<ScanStatus> | null = null
  const signatures = new Map<string, string>()
  async function collect(directory: string, depth = 0): Promise<{ path: string; modified: number; size: number }[]> {
    if (depth > 5) return []
    const files: { path: string; modified: number; size: number }[] = []
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) files.push(...await collect(path, depth + 1))
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
        const info = await stat(path)
        files.push({ path, modified: info.mtimeMs, size: info.size })
      }
      if (files.length > 10_000) throw new Error('Too many files. Select only the Lifeboard export folder.')
    }
    return files
  }
  async function scan(): Promise<ScanStatus> {
    status = { ...status, scanning: true }
    let changed = 0
    let incompatible = 0
    const errors: string[] = []
    const ignored = new Set<string>()
    let count = 0
    try {
      if (!folder) {
        status = { scanning: false, folder: null, checkedAt: new Date().toISOString(), files: 0, changed: 0, incompatible: 0, errors: [], ignored: [] }
        return status
      }
      const files = (await collect(folder)).sort((a, b) => a.modified - b.modified || a.path.localeCompare(b.path))
      count = files.length
      for (const file of files) {
        try {
          if (file.size > MAX_FILE_BYTES) throw new Error('A JSON file exceeds 20 MiB; export daily summaries in smaller files.')
          // Require an unchanged size/mtime on two scans and avoid freshly written cloud files.
          const signature = `${file.modified}:${file.size}`
          const previous = signatures.get(file.path)
          signatures.set(file.path, signature)
          if (previous !== signature || Date.now() - file.modified < 1500) continue
          const bytes = await readFile(file.path)
          const after = await stat(file.path)
          if (after.mtimeMs !== file.modified || after.size !== file.size) continue
          const hash = createHash('sha256').update(bytes).digest('hex')
          if (database.hasFile(file.path, hash)) continue
          const result = parseAutoExport(JSON.parse(bytes.toString('utf8')))
          for (const name of result.ignored) ignored.add(name)
          changed += database.import(file.path, hash, file.modified, result)
        } catch (error) {
          if (error instanceof UnsupportedExportGranularityError) { incompatible++; continue }
          // Do not include paths or record values in HTTP responses/logs.
          if (errors.length < 10) errors.push(error instanceof SyntaxError ? 'A JSON file is incomplete or invalid; it will be retried.' : safeMessage(error))
        }
      }
    } catch (error) { errors.push(safeMessage(error)) }
    status = { scanning: false, folder, checkedAt: new Date().toISOString(), files: count, changed, incompatible, errors, ignored: [...ignored] }
    return status
  }
  function requestScan() {
    if (!running) running = scan().finally(() => { running = null })
    return running
  }
  return {
    getStatus: () => status,
    setFolder: async (next: string) => {
      const normalized = normalizeFolderInput(next)
      if (!normalized || !isAbsolute(normalized)) throw new Error('Choose an absolute export folder.')
      const candidate = resolve(normalized)
      const info = await stat(candidate)
      if (!info.isDirectory()) throw new Error('The selected export location is not a folder.')
      await readdir(candidate)
      if (running) await running
      folder = candidate
      signatures.clear()
      status = { scanning: false, folder, checkedAt: null, files: 0, changed: 0, incompatible: 0, errors: [], ignored: [] }
      await requestScan()
      return requestScan()
    },
    scan: requestScan,
  }
}
/** Accept paths copied from Finder as well as shell-escaped paths dragged into Terminal. */
export function normalizeFolderInput(input: string): string {
  let folder = input.trim()
  if (folder.length >= 2 && ((folder.startsWith('"') && folder.endsWith('"')) || (folder.startsWith("'") && folder.endsWith("'")))) folder = folder.slice(1, -1)
  return folder.replace(/\\([ ~])/g, '$1')
}
function safeMessage(error: unknown): string {
  const code = (error as NodeJS.ErrnoException)?.code
  if (code === 'ENOENT') return 'Export folder or file is not available. Check the selected folder and iCloud download status.'
  if (code === 'EACCES' || code === 'EPERM') return 'The service cannot read the export folder. Check macOS file access.'
  return error instanceof Error && !code ? error.message.slice(0, 240) : 'Could not read an export file; it will be retried.'
}
