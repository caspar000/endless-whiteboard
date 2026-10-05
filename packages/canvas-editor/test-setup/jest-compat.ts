/** Upstream's tests were written for Jest. Under Vitest, `jest` is `vi`. */
import { vi } from 'vitest'

;(globalThis as unknown as { jest: typeof vi }).jest = vi
