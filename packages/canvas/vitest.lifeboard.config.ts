import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Runs a Lifeboard package's own unit suite with `tldraw` swapped for the canvas fork
 * (docs/canvas-fork-plan.md, phase 5). The suites must pass unchanged; the runner points this at
 * each package in turn (scripts/fork-suites/run.mjs).
 */
const canvas = fileURLToPath(new URL('./src/index.ts', import.meta.url))

export default defineConfig({
	resolve: { alias: [{ find: /^tldraw$/, replacement: canvas }] },
})
