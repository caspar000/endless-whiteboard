import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const setup = (file: string) => fileURLToPath(new URL(`./test-setup/${file}`, import.meta.url))

/** Upstream's Jest setup, translated: jsdom, canvas and rAF stubs, Jest's API, custom matchers. */
export const canvasTestConfig = {
	environment: 'jsdom',
	globals: true,
	setupFiles: [setup('jest-compat.ts'), 'raf/polyfill', 'jest-canvas-mock', setup('environment.ts'), setup('matchers.ts'), setup('fake-timers.ts')],
	include: ['src/**/*.test.{ts,tsx}'],
	css: false,
	// Upstream's snapshots were written by Jest 28, which prints `Array [` and `Object {`.
	snapshotFormat: { printBasicPrototype: true, escapeString: true },
} as const

export default defineConfig({
	resolve: { alias: { '~': fileURLToPath(new URL('./src', import.meta.url)) } },
	test: canvasTestConfig,
})
