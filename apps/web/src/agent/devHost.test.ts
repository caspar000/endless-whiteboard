import { afterEach, describe, expect, it, vi } from 'vitest'
import { discoverDevHost } from './devHost'

/**
 * Discovery is what replaced pasting a token, so its failure modes are the panel's failure modes.
 *
 * The branch worth pinning is 503-versus-anything-else: a host that is still booting must be waited
 * for, and a dev server that has decided there will be no host must not be polled twenty times over
 * five seconds before the panel admits it.
 */

const okResponse = (body: unknown) =>
	({ ok: true, status: 200, json: async () => body }) as Response

const errorResponse = (status: number) => ({ ok: false, status }) as Response

afterEach(() => {
	vi.unstubAllGlobals()
	vi.useRealTimers()
})

describe('discovering the dev host', () => {
	it('returns the details the dev server reports', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ port: 51234, token: 'secret' })))

		await expect(discoverDevHost()).resolves.toEqual({ port: 51234, token: 'secret' })
	})

	it('stops asking when the answer is terminal', async () => {
		// 410 is the plugin saying there will be no host this run — the host is not built, or was
		// disabled. Retrying cannot change that.
		const fetch = vi.fn().mockResolvedValue(errorResponse(410))
		vi.stubGlobal('fetch', fetch)

		await expect(discoverDevHost()).resolves.toBeNull()
		expect(fetch).toHaveBeenCalledTimes(1)
	})

	it('keeps asking while the host is still starting', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(errorResponse(503))
			.mockResolvedValueOnce(errorResponse(503))
			.mockResolvedValue(okResponse({ port: 51234, token: 'secret' }))
		vi.stubGlobal('fetch', fetch)

		await expect(discoverDevHost()).resolves.toEqual({ port: 51234, token: 'secret' })
		expect(fetch).toHaveBeenCalledTimes(3)
	})

	it('gives up rather than trusting a malformed reply', async () => {
		// A 200 whose body is not a host is a bug somewhere, not something to retry into.
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ port: 'nope' })))

		await expect(discoverDevHost()).resolves.toBeNull()
	})

	it('stops when the caller aborts, so a reload does not leave a poll running', async () => {
		const controller = new AbortController()
		controller.abort()
		const fetch = vi.fn()
		vi.stubGlobal('fetch', fetch)

		await expect(discoverDevHost(controller.signal)).resolves.toBeNull()
		expect(fetch).not.toHaveBeenCalled()
	})
})
