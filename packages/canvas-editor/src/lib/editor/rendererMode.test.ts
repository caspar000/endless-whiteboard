import { describe, expect, it } from 'vitest'
import { getRendererMode, RENDERER_STORAGE_KEY, setRendererMode } from './rendererMode'

describe('renderer mode', () => {
	it('is auto until asked otherwise, and switches at runtime', () => {
		expect(getRendererMode()).toBe('auto')
		setRendererMode('dom')
		expect(getRendererMode()).toBe('dom')
		setRendererMode('gpu')
		expect(getRendererMode()).toBe('gpu')
	})

	it('is remembered only when asked to be', () => {
		localStorage.removeItem(RENDERER_STORAGE_KEY)
		setRendererMode('dom')
		expect(localStorage.getItem(RENDERER_STORAGE_KEY)).toBeNull()
		setRendererMode('gpu', true)
		expect(localStorage.getItem(RENDERER_STORAGE_KEY)).toBe('gpu')
		localStorage.removeItem(RENDERER_STORAGE_KEY)
		setRendererMode('auto')
	})
})
