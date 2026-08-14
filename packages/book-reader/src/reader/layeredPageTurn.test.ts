import { describe, expect, it, vi } from 'vitest'
import { startLayeredPageTurn, supportsLayeredPageTurn } from './layeredPageTurn'

function styleDeclaration() {
	const values = new Map<string, { value: string; priority: string }>()
	return {
		getPropertyValue: (name: string) => values.get(name)?.value ?? '',
		getPropertyPriority: (name: string) => values.get(name)?.priority ?? '',
		setProperty: (name: string, value: string, priority = '') =>
			void values.set(name, { value, priority }),
		removeProperty: (name: string) => {
			const old = values.get(name)?.value ?? ''
			values.delete(name)
			return old
		},
		values,
	}
}

function classList() {
	const values = new Set<string>()
	return {
		add: (...names: string[]) => names.forEach((name) => values.add(name)),
		remove: (...names: string[]) => names.forEach((name) => values.delete(name)),
		contains: (name: string) => values.has(name),
	}
}

function deferred() {
	let resolve!: () => void
	const promise = new Promise<void>((done) => {
		resolve = done
	})
	return { promise, resolve }
}

describe('supportsLayeredPageTurn', () => {
	it('requires both View Transitions and the mature nested-groups implementation', () => {
		const withApi = { startViewTransition() {} } as unknown as Document
		expect(supportsLayeredPageTurn(withApi, { supports: () => true })).toBe(true)
		expect(supportsLayeredPageTurn(withApi, { supports: () => false })).toBe(false)
		expect(supportsLayeredPageTurn({} as Document, { supports: () => true })).toBe(false)
	})
})

describe('startLayeredPageTurn', () => {
	it('snapshots, navigates underneath, and restores every temporary style when finished', async () => {
		const rootStyle = styleDeclaration()
		rootStyle.setProperty('--lb-reader-vt-paper', 'old-paper')
		const rootClasses = classList()
		const frameStyle = styleDeclaration()
		frameStyle.setProperty('view-transition-name', 'existing-name', 'important')
		const finished = deferred()
		let update: (() => void | Promise<unknown>) | undefined
		const doc = {
			documentElement: { style: rootStyle, classList: rootClasses },
			startViewTransition(callback: () => void | Promise<unknown>) {
				update = callback
				return { finished: finished.promise }
			},
		} as unknown as Document
		const navigate = vi.fn()
		const onStarted = vi.fn()
		const onFinished = vi.fn()

		const started = startLayeredPageTurn({
			frame: { style: frameStyle } as unknown as HTMLElement,
			direction: 1,
			paper: '#faf8f0',
			duration: 420,
			curlAngle: 20,
			curlRadius: 8,
			navigate,
			onStarted,
			onFinished,
			document: doc,
			css: { supports: () => true },
		})

		expect(started).toBe(true)
		expect(onStarted).toHaveBeenCalledOnce()
		expect(navigate).not.toHaveBeenCalled()
		expect(rootClasses.contains('lb-reader-vt')).toBe(true)
		expect(rootClasses.contains('lb-reader-vt--forward')).toBe(true)
		expect(frameStyle.getPropertyValue('view-transition-name')).toBe('lb-reader-turn')
		expect(rootStyle.getPropertyValue('--lb-reader-vt-paper')).toBe('#faf8f0')

		await update?.()
		expect(navigate).toHaveBeenCalledOnce()
		finished.resolve()
		await finished.promise
		await Promise.resolve()

		expect(onFinished).toHaveBeenCalledOnce()
		expect(rootClasses.contains('lb-reader-vt')).toBe(false)
		expect(frameStyle.getPropertyValue('view-transition-name')).toBe('existing-name')
		expect(frameStyle.getPropertyPriority('view-transition-name')).toBe('important')
		expect(rootStyle.getPropertyValue('--lb-reader-vt-paper')).toBe('old-paper')
		expect(rootStyle.getPropertyValue('--lb-reader-vt-duration')).toBe('')
	})

	it('returns false without touching navigation when setup throws, so the caller can fall back', () => {
		const rootStyle = styleDeclaration()
		const rootClasses = classList()
		const frameStyle = styleDeclaration()
		const doc = {
			documentElement: { style: rootStyle, classList: rootClasses },
			startViewTransition() {
				throw new Error('snapshot failed')
			},
		} as unknown as Document
		const navigate = vi.fn()
		const onFinished = vi.fn()

		expect(
			startLayeredPageTurn({
				frame: { style: frameStyle } as unknown as HTMLElement,
				direction: -1,
				paper: '#fff',
				duration: 300,
				curlAngle: 0,
				curlRadius: 3,
				navigate,
				onFinished,
				document: doc,
				css: { supports: () => true },
			})
		).toBe(false)
		expect(navigate).not.toHaveBeenCalled()
		expect(onFinished).not.toHaveBeenCalled()
		expect(rootClasses.contains('lb-reader-vt')).toBe(false)
	})
})
