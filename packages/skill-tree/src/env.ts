/** Vite's dev flag, read without the `vite/client` types this package doesn't load. */
export const isDevBuild = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true

/** A browser driven by a test (Playwright sets `navigator.webdriver`). */
export const isAutomated = (): boolean => typeof navigator !== 'undefined' && navigator.webdriver === true
