import { atom } from '@lifeboard/canvas'
import { getNetworkBridge, type ExternalText } from '@lifeboard/node-kit'
import { getFeedProvider } from './providers/registry'
import { getSourceItems, getSources, recordRead } from './store'

/** How old a source's posts may be before an open card reads it again. */
export const REFRESH_MS = 15 * 60 * 1000
/** Sources read at once: a few, so twenty channels don't arrive at the server in one burst. */
const AT_ONCE = 4

/** The sources being read now, and why nothing can be read, when nothing can. */
export const reading = atom<{ sourceIds: ReadonlySet<string>; unavailable: string }>('lifeboard:feed-reading', {
	sourceIds: new Set(),
	unavailable: '',
})

/** Reads through the host's transport; `unavailable` when the host has none. */
export function readText(url: string): Promise<ExternalText> {
	const bridge = getNetworkBridge()
	if (!bridge) return Promise.resolve({ ok: false, reason: 'unavailable', message: 'This app cannot read other sites.' })
	return bridge.getText(url)
}

function setReading(sourceId: string, on: boolean): void {
	const { sourceIds, unavailable } = reading.get()
	const next = new Set(sourceIds)
	if (on) next.add(sourceId)
	else next.delete(sourceId)
	reading.set({ sourceIds: next, unavailable })
}

async function readSource(sourceId: string): Promise<'unavailable' | void> {
	const source = getSources()[sourceId]
	const provider = source && getFeedProvider(source.provider)
	if (!source) return
	if (!provider?.available) return recordRead(sourceId, { error: 'This kind of source can no longer be read.' })
	setReading(sourceId, true)
	try {
		const result = await readText(source.feedUrl)
		if (!result.ok) {
			if (result.reason === 'unavailable') {
				reading.set({ ...reading.get(), unavailable: result.message })
				return 'unavailable'
			}
			return recordRead(sourceId, { error: result.message })
		}
		if (reading.get().unavailable) reading.set({ ...reading.get(), unavailable: '' })
		const items = provider.parse(result.text, source)
		recordRead(sourceId, items ? { items } : { error: "What's at this address is no longer a feed." })
	} finally {
		setReading(sourceId, false)
	}
}

/**
 * Reads the sources whose posts are older than `REFRESH_MS` (or all of them, `force`), a few at a time.
 * A source already being read is left to that read. Stops at the first answer that says nothing can be
 * read here at all (no server).
 */
export async function refreshSources({ force = false, only }: { force?: boolean; only?: readonly string[] } = {}): Promise<void> {
	const now = Date.now()
	const due = Object.values(getSources())
		.filter((s) => !only || only.includes(s.sourceId))
		.filter((s) => !reading.get().sourceIds.has(s.sourceId))
		.filter((s) => force || now - Date.parse(getSourceItems()[s.sourceId]?.fetchedAt || '0') >= REFRESH_MS)
		.map((s) => s.sourceId)
	let stop = false
	const next = async (): Promise<void> => {
		const sourceId = due.shift()
		if (!sourceId || stop) return
		if ((await readSource(sourceId)) === 'unavailable') stop = true
		return next()
	}
	await Promise.all(Array.from({ length: AT_ONCE }, next))
}

let cards = 0
let timer: ReturnType<typeof setInterval> | null = null

/**
 * Keeps the feeds fresh while at least one feed card is mounted: reads what is due now, and checks
 * again every minute for what has become due. Returns the card's release.
 */
export function watchFeeds(): () => void {
	cards++
	if (cards === 1) {
		void refreshSources()
		timer = setInterval(() => void refreshSources(), 60 * 1000)
	}
	return () => {
		cards--
		if (cards === 0 && timer) {
			clearInterval(timer)
			timer = null
		}
	}
}
