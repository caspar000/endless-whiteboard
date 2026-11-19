import { useAssetUrl } from '@lifeboard/node-kit'
import type { CSSProperties } from 'react'
import { hashText, generatedCover } from './generatedCover'
import { LISTS, type ListId, type RandomItem } from './model'
import { POSTMARK_CENTRE, Postmark } from './Postmark'

/** How many of an item's stamps the pile draws. The timeline lists every one. */
const PILE_DEPTH = 5

/** Older stamps fade a little, newest first, so the latest reads as the answer. */
const PILE_OPACITY = [0.95, 0.82, 0.72, 0.62, 0.52]

/** A dropped picture, kept in the app's blob store (see `AssetBridge`). */
const isStored = (src: string) => src.startsWith('asset:')

/** Where the image of an item comes from: a dropped picture, one dragged from a page, or drawn. */
export function useCoverUrl(item: RandomItem, list: ListId): string {
	const stored = useAssetUrl(isStored(item.cover) ? item.cover : '')
	if (isStored(item.cover)) return stored ?? generatedCover(item, LISTS[list].shape)
	return item.cover || generatedCover(item, LISTS[list].shape)
}

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
				const spread = age === 0 ? 4 : 14
				const x = 52 + (((h % 1000) / 1000) * 2 - 1) * spread
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
							transform: `translate(${-POSTMARK_CENTRE.x * 100}%, ${-POSTMARK_CENTRE.y * 100}%) rotate(${tilt}deg)`,
							transformOrigin: `${POSTMARK_CENTRE.x * 100}% ${POSTMARK_CENTRE.y * 100}%`,
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
export function CoverFace({ item, list, fresh = false }: { item: RandomItem; list: ListId; /** Its latest stamp has just come down. */ fresh?: boolean }) {
	const url = useCoverUrl(item, list)
	return (
		<div className={`lb-rand__face lb-rand__face--${LISTS[list].shape}`}>
			<img className="lb-rand__img" src={url} alt="" draggable={false} />
			{item.stamps.length > 0 && <StampPile item={item} fresh={fresh} />}
		</div>
	)
}

/** A small cover for the row of last picks, ringed in its latest stamp's ink. */
export function Thumb({ item, list, ink, label }: { item: RandomItem; list: ListId; ink: string | null; label: string }) {
	const url = useCoverUrl(item, list)
	return (
		<li className={ink ? 'lb-rand__thumb lb-rand__thumb--stamped' : 'lb-rand__thumb'} style={ink ? ({ '--lb-rand-ink': ink } as CSSProperties) : undefined} title={label} aria-label={label} role="img">
			<img src={url} alt="" draggable={false} />
		</li>
	)
}
