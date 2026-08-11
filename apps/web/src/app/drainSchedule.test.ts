import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startDrain } from './drainSchedule'

const DRAIN = 1000
const MAX = 10_000

/**
 * Drives a drain against a mutable "when did work last happen" clock, the way the asset store does:
 * *now* while work is running, the finish timestamp afterwards.
 */
function harness() {
	let busy = false
	let finishedAt = 0
	const onDone = vi.fn()
	const cancel = startDrain({
		drainMs: DRAIN,
		maxMs: MAX,
		lastActivityAt: () => (busy ? Date.now() : finishedAt),
		onDone,
	})
	return {
		onDone,
		cancel,
		start: () => {
			busy = true
		},
		finish: () => {
			busy = false
			finishedAt = Date.now()
		},
	}
}

describe('startDrain', () => {
	beforeEach(() => vi.useFakeTimers())
	afterEach(() => vi.useRealTimers())

	it('ends after one window when no work ever happened', async () => {
		const { onDone } = harness()

		await vi.advanceTimersByTimeAsync(DRAIN - 1)
		expect(onDone).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(1)
		expect(onDone).toHaveBeenCalledTimes(1)
	})

	it('keeps waiting while work is outstanding', async () => {
		const h = harness()
		h.start()

		await vi.advanceTimersByTimeAsync(DRAIN * 5)
		expect(h.onDone).not.toHaveBeenCalled()

		h.finish()
		await vi.advanceTimersByTimeAsync(DRAIN)
		expect(h.onDone).toHaveBeenCalledTimes(1)
	})

	it('waits a full window measured from when work finished, not from the next tick', async () => {
		const h = harness()
		h.start()

		await vi.advanceTimersByTimeAsync(DRAIN * 2)
		// Work finishes 200ms into the third window.
		await vi.advanceTimersByTimeAsync(200)
		h.finish()

		// The tick at the end of that window is only 800ms after the finish...
		await vi.advanceTimersByTimeAsync(DRAIN - 200)
		expect(h.onDone).not.toHaveBeenCalled()
		// ...so the drain ends a full window after the finish, not at that tick.
		await vi.advanceTimersByTimeAsync(199)
		expect(h.onDone).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(1)
		expect(h.onDone).toHaveBeenCalledTimes(1)
	})

	it('waits out work that both starts and finishes between two ticks', async () => {
		// The regression this file exists for. An upload that begins after the drain starts and ends
		// before its first tick is never observed as running — a drain that merely asked "is anything
		// running?" unmounted 190ms after the asset src was written, inside tldraw's persist throttle,
		// and the image was lost for good.
		const h = harness()

		await vi.advanceTimersByTimeAsync(100)
		h.start()
		await vi.advanceTimersByTimeAsync(460)
		h.finish() // t=560, well before the first tick at t=1000

		await vi.advanceTimersByTimeAsync(440) // first tick: nothing running, but only 440ms of quiet
		expect(h.onDone).not.toHaveBeenCalled()

		await vi.advanceTimersByTimeAsync(559)
		expect(h.onDone).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(1) // t=1560, a full window after the finish
		expect(h.onDone).toHaveBeenCalledTimes(1)
	})

	it('extends again if new work starts during the quiet window', async () => {
		const h = harness()
		h.start()
		await vi.advanceTimersByTimeAsync(DRAIN)
		h.finish()

		await vi.advanceTimersByTimeAsync(DRAIN / 2)
		h.start() // a second image is dropped, say
		await vi.advanceTimersByTimeAsync(DRAIN * 3)
		expect(h.onDone).not.toHaveBeenCalled()

		h.finish()
		await vi.advanceTimersByTimeAsync(DRAIN)
		expect(h.onDone).toHaveBeenCalledTimes(1)
	})

	it('gives up at the deadline, so wedged work cannot pin the editor forever', async () => {
		const h = harness()
		h.start()

		await vi.advanceTimersByTimeAsync(MAX - 1)
		expect(h.onDone).not.toHaveBeenCalled()
		// The first tick at or past the deadline ends it regardless of outstanding work.
		await vi.advanceTimersByTimeAsync(1)
		expect(h.onDone).toHaveBeenCalledTimes(1)
	})

	it('never calls onDone once cancelled', async () => {
		const h = harness()
		h.start()

		await vi.advanceTimersByTimeAsync(DRAIN * 2)
		h.cancel()
		h.finish()
		await vi.advanceTimersByTimeAsync(MAX * 2)
		expect(h.onDone).not.toHaveBeenCalled()
	})

	it('is safe to cancel twice, and after it has already finished', async () => {
		const h = harness()
		await vi.advanceTimersByTimeAsync(DRAIN)
		expect(h.onDone).toHaveBeenCalledTimes(1)

		expect(() => {
			h.cancel()
			h.cancel()
		}).not.toThrow()
		await vi.advanceTimersByTimeAsync(MAX)
		expect(h.onDone).toHaveBeenCalledTimes(1)
	})
})
