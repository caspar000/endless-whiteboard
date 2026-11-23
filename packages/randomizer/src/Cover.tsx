import { generatedCover, hashText, setDraggedItem, useItemCover, useItemCoverState } from '@lifeboard/node-kit'
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { RandomItem, SourceKind } from './model'
import { Postmark } from './Postmark'

/** How many of an item's stamps the pile draws. The timeline lists every one. */
const PILE_DEPTH = 5

/** Older stamps fade a little, newest first, so the latest reads as the answer. */
const PILE_OPACITY = [0.95, 0.82, 0.72, 0.62, 0.52]

type CoverShape = SourceKind['shape']

/**
 * Stamps piled round the middle of the cover, newest on top. Each one's place and tilt come from the
 * stamp itself, so the pile looks the same every time it is drawn, on every device.
 */
export function StampPile({ item, fresh }: { item: RandomItem; fresh: boolean }) {
	const first = Math.max(0, item.stamps.length - PILE_DEPTH)
	const shown = item.stamps.slice(first)
	return (
		<div className={fresh ? 'lb-rand__pile lb-rand__pile--fresh' : 'lb-rand__pile'} aria-hidden="true">
			{shown.map((stamp, i) => {
				const age = shown.length - 1 - i
				const h = hashText(`${item.id}${stamp.kind}${stamp.date}${first + i}`)
				// Close round the middle: a ring this big (80% of the cover) would leave it if thrown as wide as before.
				const spread = age === 0 ? 2 : 6
				const x = 50 + (((h % 1000) / 1000) * 2 - 1) * spread
				const y = 50 + ((((h >>> 10) % 1000) / 1000) * 2 - 1) * spread
				const tilt = -14 + ((h >>> 20) % 26)
				return (
					<Postmark
						key={first + i}
						kind={stamp.kind}
						date={stamp.date}
						className={age === 0 ? 'lb-rand-pm lb-rand-pm--latest' : 'lb-rand-pm'}
						style={{
							left: `${x}%`,
							top: `${y}%`,
							opacity: PILE_OPACITY[age],
							transform: `translate(-50%, -50%) rotate(${tilt}deg)`,
						}}
					/>
				)
			})}
		</div>
	)
}

/**
 * One item's face, the full size of the window: its cover with its stamps on it. Each half of the
 * split flap shows half of one of these, so the stamps flip with the art.
 */
export function CoverFace({ item, shape, fresh = false }: { item: RandomItem; shape: CoverShape; /** Its latest stamp has just come down. */ fresh?: boolean }) {
	// A dropped picture still being fetched from the store is loading too: its drawn cover is no answer.
	const { url, pending } = useItemCoverState(item, shape)
	const [ready, setReady] = useState<string | null>(null)
	const [failed, setFailed] = useState<string | null>(null)
	const img = useRef<HTMLImageElement>(null)
	// A picture already in the cache is ready before the first paint: no placeholder flashes up.
	useLayoutEffect(() => {
		const el = img.current
		if (el?.complete && el.naturalWidth > 0) setReady(url)
	}, [url])
	const src = failed === url ? generatedCover(item, shape) : url
	const loading = pending || (ready !== url && failed !== url)
	/*
	 * A fresh <img> for each picture (`key`), and a placeholder until it has loaded (DARK-13). Changing
	 * the `src` of the same element keeps the old picture up until the new one arrives, so a shuffle
	 * faster than the covers loaded flipped through the same cover again and again.
	 */
	return (
		<div className={`lb-rand__face lb-rand__face--${shape}`}>
			{loading && (
				<div className="lb-rand__ph">
					<span>{item.title}</span>
				</div>
			)}
			<img
				key={src}
				ref={img}
				className={loading ? 'lb-rand__img lb-rand__img--loading' : 'lb-rand__img'}
				src={src}
				alt=""
				draggable={false}
				onLoad={() => setReady(url)}
				onError={() => setFailed(url)}
			/>
			{item.stamps.length > 0 && <StampPile item={item} fresh={fresh} />}
		</div>
	)
}

/** Starts loading the pictures a shuffle is about to flip through, so they're there when it does. */
export function preloadCovers(items: readonly RandomItem[]): void {
	if (typeof Image === 'undefined') return
	for (const item of items) {
		if (!item.cover || item.cover.startsWith('asset:')) continue
		const pic = new Image()
		pic.decoding = 'async'
		pic.src = item.cover
	}
}

/**
 * A small cover for the row of last picks, ringed in its latest stamp's ink. It can be dragged onto
 * another card that takes items (a backlog), as the kit's dragged item (DARK-11).
 */
export function Thumb({ item, shape, ink, label, from, via }: { item: RandomItem; shape: CoverShape; ink: string | null; label: string; from: string; via: string }) {
	const url = useItemCover(item, shape)
	return (
		<li
			className={ink ? 'lb-rand__thumb lb-rand__thumb--stamped' : 'lb-rand__thumb'}
			style={ink ? ({ '--lb-rand-ink': ink } as CSSProperties) : undefined}
			title={label}
			aria-label={label}
			role="img"
			draggable
			onPointerDown={(e) => e.stopPropagation()}
			onDragStart={(e) => {
				e.stopPropagation()
				const { id, title, creator, year, cover, detail } = item
				setDraggedItem(e.dataTransfer, { entry: { id, title, creator, year, cover, url: item.url ?? '', ...(detail ? { detail } : {}) }, from, via })
				e.dataTransfer.effectAllowed = 'copy'
			}}
		>
			<img src={url} alt="" draggable={false} />
		</li>
	)
}
