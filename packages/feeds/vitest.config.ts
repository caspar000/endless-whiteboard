import { defineConfig } from 'vitest/config'

// jsdom for the browser's own XML and HTML parsers, which the providers read feeds with.
export default defineConfig({ test: { environment: 'jsdom' } })
