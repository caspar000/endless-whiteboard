import { describe, expect, it, vi } from 'vitest'
import type { PaintedPage, PaintPageOptions, PaintWindow } from './paintPage'
import {
	captureEpubPage,
	createEpubPageCaptureCache,
	type EpubPageCaptureTarget,
} from './epubPageCapture'

const page = (width = 600, height = 900) =>
	({ texture: { width: width * 2, height: height * 2 } as HTMLCanvasElement, width, height })

const target = (key: string, docs: readonly Document[]): EpubPageCaptureTarget =>
	({ key, docs } as EpubPageCaptureTarget)

describe('createEpubPageCaptureCache', () => {
	it('returns a capture only for the same layout and mounted section documents', () => {
		const cache = createEpubPageCaptureCache()
		const first = {} as Document
		const second = {} as Document
		const captured = page()
		cache.put(target('layout-a', [first]), captured)

		expect(cache.get(target('layout-a', [first]))).toBe(captured)
		expect(cache.get(target('layout-b', [first]))).toBeUndefined()
		expect(cache.get(target('layout-a', [second]))).toBeUndefined()
		expect(cache.get(target('layout-a', [first, second]))).toBeUndefined()
	})

	it('drops the prepared pixels when invalidated', () => {
		const cache = createEpubPageCaptureCache()
		const doc = {} as Document
		cache.put(target('layout', [doc]), page())
		cache.clear()
		expect(cache.get(target('layout', [doc]))).toBeUndefined()
	})
})

describe('captureEpubPage', () => {
	it('keeps live-positioned prose authoritative and composites bounded visuals separately', async () => {
		const drawImage = vi.fn()
		const fillRect = vi.fn()
		const scale = vi.fn()
		const texture = outputCanvas({ drawImage, fillRect, scale })
		const image = elementAt(450, 20, 100, 50)
		const doc = captureDocument([image])
		const request = captureRequest(doc, texture)
		const visual = { width: 200, height: 100 } as HTMLCanvasElement
		const layer = { width: 1200, height: 1800 } as HTMLCanvasElement
		const toCanvas = vi.fn(async () => visual)
		const paint = paintStub({ texture: layer, width: 600, height: 900 })

		const result = await captureEpubPage(request, toCanvas, paint)

		expect(result).toEqual({ texture, width: 600, height: 900 })
		expect(texture.width).toBe(1200)
		expect(texture.height).toBe(1800)
		expect(scale).toHaveBeenCalledWith(2, 2)
		expect(fillRect).toHaveBeenCalledWith(0, 0, 600, 900)
		expect(toCanvas).toHaveBeenCalledWith(
			image,
			expect.objectContaining({
				dpr: 2,
				embedFonts: true,
				reconcile: true,
				useProxy: '',
			})
		)
		expect(paint).toHaveBeenCalledWith(
			doc,
			600,
			900,
			'#f5f0e6',
			{ x: -370, y: 70 },
			{ left: 50, top: 70, right: 550, bottom: 770 },
			expect.objectContaining({ fillPaper: false, omit: new Set([image]) })
		)
		expect(drawImage).toHaveBeenNthCalledWith(1, visual, 0, 0, 200, 100, 80, 90, 100, 50)
		expect(drawImage).toHaveBeenNthCalledWith(2, layer, 0, 0, 600, 900)
	})

	it('does not load the DOM capture engine for a prose-only page', async () => {
		const texture = outputCanvas()
		const doc = captureDocument()
		const request = captureRequest(doc, texture)
		const toCanvas = vi.fn()
		const layer = page(600, 900)
		const paint = paintStub(layer)

		await expect(captureEpubPage(request, toCanvas, paint)).resolves.toEqual({
			texture,
			width: 600,
			height: 900,
		})
		expect(toCanvas).not.toHaveBeenCalled()
		expect(paint).toHaveBeenCalledOnce()
	})

	it('falls back to live painting when an individual visual cannot be captured', async () => {
		const texture = outputCanvas()
		const image = elementAt(450, 20, 100, 50)
		const doc = captureDocument([image])
		const request = captureRequest(doc, texture)
		const paint = paintStub()

		await expect(
			captureEpubPage(
				request,
				async () => {
					throw new Error('tainted resource')
				},
				paint
			)
		).resolves.toEqual({ texture, width: 600, height: 900 })
		const options = paint.mock.calls[0]?.[6]
		expect(options?.omit).toEqual(new Set())
	})

	it('does not rasterize an atomic element larger than the visible page', async () => {
		const texture = outputCanvas()
		const oversizedFigure = elementAt(420, 0, 700, 700)
		const doc = captureDocument([oversizedFigure])
		const toCanvas = vi.fn()
		const paint = paintStub()

		await captureEpubPage(captureRequest(doc, texture), toCanvas, paint)

		expect(toCanvas).not.toHaveBeenCalled()
		expect(paint.mock.calls[0]?.[6]?.omit).toEqual(new Set())
	})
})

function paintStub(result: PaintedPage = page(600, 900)) {
	return vi.fn(
		(
			_doc: Document,
			_width: number,
			_height: number,
			_paper: string,
			_offset: { x: number; y: number },
			_clip?: PaintWindow | null,
			_options?: PaintPageOptions
		) => result
	)
}

function outputCanvas(
	context = { drawImage: vi.fn(), fillRect: vi.fn(), scale: vi.fn() }
): HTMLCanvasElement {
	return {
		width: 0,
		height: 0,
		getContext: () => ({ ...context, fillStyle: '' }),
	} as unknown as HTMLCanvasElement
}

function captureDocument(elements: Element[] = []): Document {
	return {
		querySelectorAll: () => elements,
		images: [],
		fonts: { ready: Promise.resolve() },
	} as unknown as Document
}

function elementAt(left: number, top: number, width: number, height: number): Element {
	return {
		contains: () => false,
		getBoundingClientRect: () =>
			({
				x: left,
				y: top,
				left,
				top,
				right: left + width,
				bottom: top + height,
				width,
				height,
				toJSON: () => ({}),
			}) as DOMRect,
	} as unknown as Element
}

function captureRequest(doc: Document, texture: HTMLCanvasElement): EpubPageCaptureTarget {
	return {
		key: 'page',
		docs: [doc],
		sources: [
			{
				doc,
				clip: { x: 420, y: 0, width: 500, height: 700 },
				paste: { left: 50, top: 70, right: 550, bottom: 770 },
				viewport: { left: 420, top: 0, right: 920, bottom: 700 },
			},
		],
		width: 600,
		height: 900,
		dpr: 2,
		paper: '#f5f0e6',
		ownerDocument: { createElement: () => texture } as unknown as Document,
	}
}
