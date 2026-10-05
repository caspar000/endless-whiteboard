import { Box2d } from '../Box2d'
import { Vec2d } from '../Vec2d'
import { pointInPolygon } from '../utils'

export interface Geometry2dOptions {
	isFilled: boolean
	isClosed: boolean
	isLabel?: boolean
	isSnappable?: boolean
}

/** @public */
export abstract class Geometry2d {
	isFilled = false
	isClosed = true
	isLabel = false
	isSnappable = true

	constructor(opts: Geometry2dOptions) {
		this.isFilled = opts.isFilled
		this.isClosed = opts.isClosed
		this.isSnappable = opts.isSnappable ?? false
		this.isLabel = opts.isLabel ?? false
	}

	abstract getVertices(): Vec2d[]

	abstract nearestPoint(point: Vec2d): Vec2d

	hitTestPoint(point: Vec2d, margin = 0, hitInside = false) {
		// We've removed the broad phase here; that should be done outside of the call
		return this.distanceToPoint(point, hitInside) <= margin
	}

	distanceToPoint(point: Vec2d, hitInside = false) {
		const dist = point.dist(this.nearestPoint(point))

		if (this.isClosed && (this.isFilled || hitInside) && pointInPolygon(point, this.vertices)) {
			return -dist
		}
		return dist
	}

	distanceToLineSegment(A: Vec2d, B: Vec2d) {
		const point = this.nearestPointOnLineSegment(A, B)
		const dist = Vec2d.DistanceToLineSegment(A, B, point) // repeated, bleh
		return this.isClosed && this.isFilled && pointInPolygon(point, this.vertices) ? -dist : dist
	}

	hitTestLineSegment(A: Vec2d, B: Vec2d, distance = 0): boolean {
		return this.distanceToLineSegment(A, B) <= distance
	}

	nearestPointOnLineSegment(A: Vec2d, B: Vec2d): Vec2d {
		let distance = Infinity
		let nearest: Vec2d | undefined
		for (let i = 0; i < this.vertices.length; i++) {
			const point = this.vertices[i]
			const d = Vec2d.DistanceToLineSegment(A, B, point)
			if (d < distance) {
				distance = d
				nearest = point
			}
		}
		if (!nearest) throw Error('nearest point not found')
		return nearest
	}

	isPointInBounds(point: Vec2d, margin = 0) {
		const { bounds } = this
		return !(
			point.x < bounds.minX - margin ||
			point.y < bounds.minY - margin ||
			point.x > bounds.maxX + margin ||
			point.y > bounds.maxY + margin
		)
	}

	/**
	 * The point a fraction `t` of the way along the outline, from its first vertex (a closed outline
	 * includes the edge back to the start). 1 is the end; beyond 0 to 1, `t` wraps: 1.25 is a quarter
	 * of the way round again.
	 *
	 * @public
	 */
	interpolateAlongEdge(t: number): Vec2d {
		const points = this.isClosed ? [...this.vertices, this.vertices[0]] : this.vertices
		if (points.length < 2) return points[0]?.clone() ?? new Vec2d()
		const lengths = points.slice(1).map((p, i) => Vec2d.Dist(points[i], p))
		const total = lengths.reduce((sum, length) => sum + length, 0)
		if (total === 0) return points[0].clone()
		// 0 to 1 runs start to end; only values outside that wrap.
		const f = t < 0 || t > 1 ? ((t % 1) + 1) % 1 : t
		let distance = f * total
		for (let i = 0; i < lengths.length; i++) {
			if (distance <= lengths[i] || i === lengths.length - 1) {
				return Vec2d.Lrp(points[i], points[i + 1], lengths[i] ? Math.min(1, distance / lengths[i]) : 0)
			}
			distance -= lengths[i]
		}
		return points[points.length - 1].clone()
	}

	_vertices: Vec2d[] | undefined

	// eslint-disable-next-line no-restricted-syntax
	get vertices(): Vec2d[] {
		if (!this._vertices) {
			this._vertices = this.getVertices()
		}

		return this._vertices
	}

	getBounds() {
		return Box2d.FromPoints(this.vertices)
	}

	_bounds: Box2d | undefined

	// eslint-disable-next-line no-restricted-syntax
	get bounds(): Box2d {
		if (!this._bounds) {
			this._bounds = this.getBounds()
		}
		return this._bounds
	}

	_snapPoints: Vec2d[] | undefined

	// eslint-disable-next-line no-restricted-syntax
	get snapPoints() {
		if (!this._snapPoints) {
			this._snapPoints = this.bounds.snapPoints
		}
		return this._snapPoints
	}

	// eslint-disable-next-line no-restricted-syntax
	get center() {
		return this.bounds.center
	}

	_area: number | undefined

	// eslint-disable-next-line no-restricted-syntax
	get area() {
		if (!this._area) {
			this._area = this.getArea()
		}
		return this._area
	}

	getArea() {
		if (!this.isClosed) {
			return 0
		}
		const { vertices } = this
		let area = 0
		for (let i = 0, n = vertices.length; i < n; i++) {
			const curr = vertices[i]
			const next = vertices[(i + 1) % n]
			area += curr.x * next.y - next.x * curr.y
		}
		return area / 2
	}

	toSimpleSvgPath() {
		let path = ''

		const { vertices } = this
		const n = vertices.length

		if (n === 0) return path

		path += `M${vertices[0].x},${vertices[0].y}`

		for (let i = 1; i < n; i++) {
			path += `L${vertices[i].x},${vertices[i].y}`
		}

		if (this.isClosed) {
			path += 'Z'
		}

		return path
	}
}
