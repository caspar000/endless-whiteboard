import {
	BufferAttribute,
	BufferGeometry,
	CanvasTexture,
	LinearFilter,
	Mesh,
	MeshStandardMaterial,
	SRGBColorSpace,
} from 'three'
import type { DieKind } from '../kinds'
import { faceLayouts, type Mark } from './layout'
import { faceNormals, sizeScale, solidFor } from './solids'
import { bodyColourFor, edgeColourFor, inkOn } from '../prefs'
import { THROW_SCALE } from './simulate'

/**
 * A die you can look at: the mesh, and the numbers printed on it.
 *
 * Built from the same `solids.ts` tables the physics hull comes from, so the picture and the collision
 * shape are the same object by construction rather than by agreement.
 */

/**
 * The two ends of the result colour, matching `--lb-danger` and `--lb-accent`.
 *
 * Hardcoded here, unlike everywhere else in the app, and for a reason: a die is a physical object in a
 * lit scene, not chrome. It has one appearance in both themes — a bone die does not turn charcoal
 * because the UI did — so there is no theme token to read.
 */
const LOW_INK = [0xd3, 0x37, 0x3c] as const
const HIGH_INK = [0x3f, 0x66, 0xf5] as const

/**
 * The ink for the face a die landed on: the ordinary numeral colour, mixed toward red or blue by how far
 * from the middle of the die the roll was. A 20 on a d20 arrives fully blue, an 11 barely tinted — the
 * same ramp the result card uses, so the die and the card say the same thing the same way.
 *
 * Mixed from `inkOn(body)` rather than from a fixed near-black, which is what keeps it working on a dark
 * die: the neutral end of the ramp is whatever that die's numerals are.
 */
export function resultInk(side: 'max' | 'min', strength: number, body: string): string {
	const target = side === 'max' ? HIGH_INK : LOW_INK
	const hex = inkOn(body).replace('#', '')
	const base = [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16))
	const mix = (i: number) => Math.round(base[i]! + (target[i]! - base[i]!) * strength)
	return `rgb(${mix(0)}, ${mix(1)}, ${mix(2)})`
}

/**
 * Face textures are drawn, not chamfered.
 *
 * A real bevel is what makes a die look expensive, and at the size these render — a die is about 44 page
 * units across, so 44px at 100% zoom — a chamfer is a pixel or two wide. Painting the edge highlight into
 * each face costs nothing, survives any zoom, and reads the same. The geometry stays the honest convex
 * solid the physics uses.
 */
const TEXTURE_SIZE = 128

const textures = new Map<string, CanvasTexture>()

/*
 * Numeral size, as a multiple of the face's incircle **radius**.
 *
 * So `1.4` is a type size of 0.7 × the incircle's diameter — the numeral filling about 70% of the room
 * the face has, which is how a real die is marked. Sized against the *texture* instead (as this first
 * was) a d20's numbers ran over their triangles; filling the incircle completely was legible and too
 * loud.
 *
 * The d4 keeps its own, larger pair: its numerals sit at the corners of a triangle rather than in the
 * middle of a face, so they have a different amount of room and shrinking them to match would make the
 * one die that needs three numbers the one whose numbers you cannot read.
 */
const NUMERAL_FILL = 1.4
/** Two digits have to fit the same circle as one, so wide labels shrink rather than the die growing. */
const WIDE_NUMERAL_FILL = 1
/*
 * The d4's corner numerals are much smaller, because there are three of them on one triangle.
 *
 * Sized as though each had the face to itself, they overlapped each other and ran off the edges — a
 * tangle of nine numbers where a tetrahedron shows three faces at once. Each mark really has about a
 * third of the face, and this is what that is worth.
 */
const CORNER_NUMERAL_FILL = 1.15
const WIDE_CORNER_NUMERAL_FILL = 0.85

/** The digits that are each other upside down, and so need saying which way up they are. */
const UNDERLINED = new Set(['6', '9'])

function drawMark(
	ctx: CanvasRenderingContext2D,
	mark: Mark,
	text: string,
	size: number,
	inradius: number,
	ink: string,
	atCorner: boolean
): void {
	const x = mark.uv[0] * size
	// Canvas counts y downward and a texture counts it upward, so one of the two has to flip. Doing it
	// here keeps `flipY` at its default and the UVs in the mesh unmirrored.
	const y = (1 - mark.uv[1]) * size
	const wide = text.length > 1
	const fill = atCorner
		? wide
			? WIDE_CORNER_NUMERAL_FILL
			: CORNER_NUMERAL_FILL
		: wide
			? WIDE_NUMERAL_FILL
			: NUMERAL_FILL
	const fontSize = inradius * size * fill

	ctx.save()
	ctx.translate(x, y)
	ctx.rotate(mark.rotation)
	ctx.fillStyle = ink
	ctx.font = `700 ${fontSize}px ui-sans-serif, system-ui, sans-serif`
	ctx.textAlign = 'center'
	ctx.textBaseline = 'middle'
	ctx.fillText(text, 0, 0)

	/*
	 * The underline every real die puts under its 6 and its 9.
	 *
	 * Not decoration: on a die you can pick up and turn, those two digits are the same glyph upside
	 * down, and the bar is the only thing that says which way up you are meant to read it. The dice here
	 * are seen from directly above and can come to rest at any angle, so the ambiguity is exactly as
	 * real as it is on a table.
	 */
	if (UNDERLINED.has(text)) {
		const width = ctx.measureText(text).width
		ctx.fillRect(-width * 0.42, fontSize * 0.42, width * 0.84, Math.max(1, fontSize * 0.09))
	}
	ctx.restore()
}

/**
 * One face's image.
 *
 * `highlight` names a **label**, not a face, and that distinction is the d4's. Six of the seven dice put
 * one numeral per face, so highlighting "the result" and "that face" are the same instruction. A d4 is
 * read at a *vertex*, and that vertex's numeral is printed on all three faces around it — so inking a
 * face there coloured three unrelated numbers and left the answer black.
 */
function textureFor(
	kind: DieKind,
	faceIndex: number,
	labels: readonly string[],
	highlight?: { label: number; ink: string }
): CanvasTexture {
	const layout = faceLayouts(kind)[faceIndex]!
	const marks = layout.marks
	const shown = marks.map((mark) => labels[mark.label] ?? '')
	const body = bodyColourFor(kind)
	const plain = inkOn(body)
	const inks = marks.map((mark) =>
		highlight && mark.label === highlight.label ? highlight.ink : plain
	)
	const edge = edgeColourFor(kind)
	// The preferences are part of the key rather than something that invalidates the cache: the renderer
	// is lazily loaded and may not exist when a colour is changed, so keying is the version that cannot
	// go stale.
	const key = `${kind}:${faceIndex}:${shown.join(',')}:${inks.join(',')}:${body}:${edge ?? 'none'}`
	const cached = textures.get(key)
	if (cached) return cached

	const canvas = document.createElement('canvas')
	canvas.width = TEXTURE_SIZE
	canvas.height = TEXTURE_SIZE
	const ctx = canvas.getContext('2d')!

	ctx.fillStyle = body
	ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE)

	/*
	 * The edge highlight: each face draws a line just inside its own outline, and neighbouring faces'
	 * lines meet to read as the die's wireframe.
	 *
	 * Drawn along the face's actual polygon (`layout.uvs`) rather than as a rectangle round the texture,
	 * because a face is a triangle or a pentagon and a rectangle would put the line out in the margin
	 * where nothing can see it. Replaces an earlier blurred dark rim that was standing in for a bevel.
	 */
	if (edge) {
		// The highlighted mark's ink if this face carries it, whichever corner that is — otherwise the
		// plain one. Taking `inks[0]` left a d4's result face outlined in ordinary ink whenever its winning
		// corner was not the first.
		const followed = edgeColourFor(kind) === plain ? (inks.find((c) => c !== plain) ?? plain) : edge
		ctx.save()
		ctx.strokeStyle = followed
		ctx.lineWidth = TEXTURE_SIZE * 0.028
		ctx.lineJoin = 'round'
		ctx.beginPath()
		layout.uvs.forEach(([u, v], i) => {
			const x = u * TEXTURE_SIZE
			const y = (1 - v) * TEXTURE_SIZE
			if (i === 0) ctx.moveTo(x, y)
			else ctx.lineTo(x, y)
		})
		ctx.closePath()
		ctx.stroke()
		ctx.restore()
	}

	// More than one mark on a face means corner marks — the d4, whose numerals get their own sizing.
	const atCorner = marks.length > 1
	marks.forEach((mark, i) =>
		drawMark(ctx, mark, shown[i]!, TEXTURE_SIZE, layout.inradius, inks[i]!, atCorner)
	)

	const texture = new CanvasTexture(canvas)
	texture.colorSpace = SRGBColorSpace
	// No mipmaps: a die is small on screen and its numerals are thin, and minification blurs them into
	// grey. Linear filtering on the full-size image keeps them legible.
	texture.generateMipmaps = false
	texture.minFilter = LinearFilter
	texture.magFilter = LinearFilter
	textures.set(key, texture)
	return texture
}

const geometries = new Map<DieKind, BufferGeometry>()

/**
 * The mesh for a solid, cached per kind.
 *
 * Each face becomes a triangle fan with its own geometry *group*, so a face can carry its own material
 * and therefore its own number. Normals are the face's own — flat shading, deliberately: a die is a
 * faceted object and smoothing it would make a d20 look like a ball.
 */
export function geometryFor(kind: DieKind): BufferGeometry {
	const cached = geometries.get(kind)
	if (cached) return cached

	const { vertices, faces } = solidFor(kind)
	const normals = faceNormals(kind)
	const layouts = faceLayouts(kind)

	const positions: number[] = []
	const normalData: number[] = []
	const uvData: number[] = []
	const geometry = new BufferGeometry()

	faces.forEach((face, faceIndex) => {
		const start = positions.length / 3
		const normal = normals[faceIndex]!
		const uvs = layouts[faceIndex]!.uvs
		// Fan from the first corner. Every face here is convex (asserted in solids.test.ts), which is
		// what makes a fan a valid triangulation of it.
		for (let i = 1; i < face.length - 1; i++) {
			for (const corner of [0, i, i + 1]) {
				const [x, y, z] = vertices[face[corner]!]!
				// Volume-matched, so the set looks like a set — see `sizeScale`.
				const r = THROW_SCALE.radius * sizeScale(kind)
				positions.push(x * r, y * r, z * r)
				normalData.push(...normal)
				uvData.push(...uvs[corner]!)
			}
		}
		geometry.addGroup(start, positions.length / 3 - start, faceIndex)
	})

	geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
	geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normalData), 3))
	geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvData), 2))
	geometries.set(kind, geometry)
	return geometry
}

/**
 * One material per face, carrying that face's number, all in ordinary ink.
 *
 * Not cached: the labels are rotated per roll (`rotateLabels`), so these are per-die-per-throw. The
 * *textures* underneath them are cached, which is where the cost actually is.
 */
export function materialsFor(kind: DieKind, labels: readonly string[]): MeshStandardMaterial[] {
	return solidFor(kind).faces.map(
		(_, faceIndex) =>
			new MeshStandardMaterial({
				map: textureFor(kind, faceIndex, labels),
				// Enough sheen to catch the light as it tumbles, not enough to look like plastic.
				roughness: 0.45,
				metalness: 0.05,
				flatShading: true,
			})
	)
}

/**
 * Recolours the result's numeral, in place, once the die has stopped.
 *
 * The result face is inked in the roll's own colour — the same red-to-blue ramp the card uses — because
 * from straight above you can see the top face *and* the ring of faces around it, all legible, so
 * without something distinguishing it there is no telling which number the die actually rolled.
 *
 * Applied on settling rather than at build time, which is the point: a die whose answer was already
 * coloured mid-tumble told you the result before it landed. The whole roll is decided in advance, so
 * that spoiler was entirely avoidable.
 */
export function inkResultFace(
	mesh: Mesh,
	kind: DieKind,
	labels: readonly string[],
	result: number,
	ink: string
): void {
	const materials = mesh.material
	if (!Array.isArray(materials)) return
	// Every face that carries the result's numeral — one face for most dice, three for a d4's apex.
	faceLayouts(kind).forEach((layout, faceIndex) => {
		if (!layout.marks.some((mark) => mark.label === result)) return
		const previous = materials[faceIndex]
		materials[faceIndex] = new MeshStandardMaterial({
			map: textureFor(kind, faceIndex, labels, { label: result, ink }),
			roughness: 0.45,
			metalness: 0.05,
			flatShading: true,
		})
		// The texture underneath is cached and shared, so only the material itself is ours to free.
		previous?.dispose()
	})
}

/** Frees the module-level caches. Called when the last board with dice on it goes away. */
export function disposeDiceAssets(): void {
	for (const geometry of geometries.values()) geometry.dispose()
	geometries.clear()
	for (const texture of textures.values()) texture.dispose()
	textures.clear()
}
