/**
 * Fake timers for every file, as upstream's Jest config had them (`fakeTimers.enableGlobally`). Last
 * of the setup files on purpose: anything loaded earlier (fake-indexeddb) keeps the real scheduler,
 * which is how it was under Jest, and IndexedDB work would otherwise never complete.
 */
import { vi } from 'vitest'

vi.useFakeTimers()
