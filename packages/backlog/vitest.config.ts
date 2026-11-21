import { defineConfig } from 'vitest/config'

// jsdom for the rendered card tests.
export default defineConfig({ test: { environment: 'jsdom' } })
