/**
 * A backup being imported, for the sidebar and Settings → Storage: which stage it's at and how far
 * along. A big backup (a Freeform import runs past a gigabyte) takes minutes, and the import keeps
 * going if you leave the Storage tab, so the progress lives here rather than in the tab.
 */
export type ImportProgress =
	| { stage: 'reading'; bytes: number }
	| { stage: 'files' | 'boards'; done: number; total: number }

let current: ImportProgress | null = null
const listeners = new Set<() => void>()

export const getImportProgress = (): ImportProgress | null => current

export function setImportProgress(next: ImportProgress | null): void {
	current = next
	for (const listener of listeners) listener()
}

export function subscribeToImportProgress(listener: () => void): () => void {
	listeners.add(listener)
	return () => listeners.delete(listener)
}

/** How far along, 0 to 1: reading is the first tenth, files most of the rest, boards the last tenth. */
export function importShare(progress: ImportProgress): number {
	if (progress.stage === 'reading') return 0.05
	const part = progress.total ? progress.done / progress.total : 1
	return progress.stage === 'files' ? 0.1 + part * 0.8 : 0.9 + part * 0.1
}

/** "Reading 1.3 GB", "Files 312 of 2,141", "Boards 5 of 27". */
export function importDetail(progress: ImportProgress): string {
	if (progress.stage === 'reading') {
		const gb = progress.bytes / 1024 ** 3
		return `Reading ${gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.max(1, Math.round(progress.bytes / 1024 ** 2))} MB`}`
	}
	const n = (value: number) => value.toLocaleString()
	return `${progress.stage === 'files' ? 'Files' : 'Boards'} ${n(progress.done)} of ${n(progress.total)}`
}
