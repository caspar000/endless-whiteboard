import { ImageAtlas } from './atlas'
import type { GpuImage } from './primitives'

/** What the atlas asks of WebGL, doing nothing; `size` is the texture's. */
function fakeGl(size: number): WebGL2RenderingContext {
	const noop = () => undefined
	return new Proxy({ getParameter: () => size, createTexture: () => ({}) } as Record<string, unknown>, {
		get: (target, key) => (key in target ? target[key as string] : typeof key === 'string' && /^[A-Z_0-9]+$/.test(key) ? 0 : noop),
	}) as unknown as WebGL2RenderingContext
}

const picture = (key: string, w: number, h: number, ready = true): GpuImage => ({ kind: 'image', x: 0, y: 0, w, h, key, draw: () => (ready ? undefined : false) })

describe("the GPU layer's picture atlas", () => {
	it("gives back the room of a picture that isn't ready", () => {
		const atlas = new ImageAtlas(fakeGl(256))
		expect(atlas.raster(picture('loading', 40, 20, false), 1, 0, 0)).toBeUndefined()
		// Where the one that wasn't ready would have gone.
		const next = atlas.raster(picture('ready', 40, 20), 1, 0, 0)!
		expect([next.x, next.y]).toEqual([0, 0])
	})

	it('gives back a new shelf begun for one that isn\'t ready', () => {
		const atlas = new ImageAtlas(fakeGl(256))
		atlas.raster(picture('a', 200, 20), 1, 0, 0)
		// Too wide for the rest of the first shelf: it would start the second.
		expect(atlas.raster(picture('loading', 100, 20, false), 1, 0, 0)).toBeUndefined()
		const next = atlas.raster(picture('b', 40, 20), 1, 0, 0)!
		expect([next.x, next.y]).toEqual([206, 0])
	})

	it("doesn't start again empty for a picture that may not clear it", () => {
		const atlas = new ImageAtlas(fakeGl(64))
		const kept = picture('kept', 50, 50)
		atlas.raster(kept, 1, 0, 0)
		expect(atlas.hasRoom()).toBe(false)
		expect(atlas.raster(picture('ahead', 50, 50), 1, 0, 0, false)).toBeUndefined()
		expect(atlas.latest(kept)).toBeDefined()
		// One that may clear it does.
		expect(atlas.raster(picture('on screen', 50, 50), 1, 0, 0)).toBeDefined()
		expect(atlas.latest(kept)).toBeUndefined()
	})
})
