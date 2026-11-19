import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import { tick } from './sound'

/**
 * A row of split-flap letter tiles, like a departure board's.
 *
 * Driven by hand rather than by React: a rattle changes each tile five or so times in a quarter of a
 * second, and the letters are written straight into the tiles instead of re-rendering the card for
 * every one. React renders the empty tiles once; `text` (when not rattling) and `rattle` fill them.
 */

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

export interface TilesHandle {
	/** Rattles every tile through random letters and settles on `text`, left to right. */
	rattle(text: string, delay: number): Promise<void>
}

const fit = (text: string, n: number) => Array.from(text.toUpperCase().padEnd(n, ' ')).slice(0, n)

function setChar(tile: HTMLElement, ch: string, animate: boolean): void {
	tile.dataset.c = ch
	const span = tile.firstElementChild as HTMLElement | null
	if (!span) return
	span.textContent = ch === ' ' ? '' : ch
	if (animate && typeof span.animate === 'function') {
		span.animate([{ transform: 'translateY(-40%) scaleY(.35)', opacity: 0.35 }, { transform: 'none', opacity: 1 }], { duration: 70, easing: 'ease-out' })
	}
}

export function Tiles({
	count,
	text,
	frozen,
	className,
	handle,
}: {
	count: number
	/** What the tiles say at rest. */
	text: string
	/** While a shuffle runs, `text` is left alone so it cannot overwrite a rattle half-way. */
	frozen: boolean
	className: string
	handle: Ref<TilesHandle>
}) {
	const row = useRef<HTMLDivElement>(null)
	const tiles = () => Array.from(row.current?.children ?? []) as HTMLElement[]

	useEffect(() => {
		if (frozen) return
		const chars = fit(text, count)
		tiles().forEach((tile, i) => setChar(tile, chars[i] ?? ' ', false))
	}, [text, count, frozen])

	useImperativeHandle(
		handle,
		() => ({
			rattle(next, delay) {
				const chars = fit(next, count)
				return Promise.all(
					tiles().map(
						(tile, j) =>
							new Promise<void>((resolve) => {
								const final = chars[j] ?? ' '
								if (final === ' ' && tile.dataset.c === ' ') return resolve()
								const steps = 3 + Math.floor(Math.random() * 4)
								let k = 0
								const step = () => {
									if (!tile.isConnected) return resolve()
									if (k < steps) {
										setChar(tile, CHARS[Math.floor(Math.random() * CHARS.length)]!, true)
										if (k % 2 === 0) tick()
										k++
										setTimeout(step, 38)
									} else {
										setChar(tile, final, true)
										tick()
										resolve()
									}
								}
								setTimeout(step, delay + j * 26)
							})
					)
				).then(() => undefined)
			},
		}),
		[count]
	)

	return (
		<div ref={row} className={className} style={{ gridTemplateColumns: `repeat(${count}, 1fr)` }}>
			{Array.from({ length: count }, (_, i) => (
				<div key={i} className="lb-rand__tile" data-c=" ">
					<span />
				</div>
			))}
		</div>
	)
}
