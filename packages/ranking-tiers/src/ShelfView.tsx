import { useItemCover, type SourceEntry, type SourceKind } from '@lifeboard/node-kit'
import { ChevronLeft } from 'lucide-react'
import { Fragment, useEffect, useRef, useState, type DragEvent, type ReactNode, type SyntheticEvent } from 'react'
import type { Band } from './model'
import { TierIcon, tierStyle } from './tierLook'

/**
 * The ranking as a bookcase (DARK-14, design 1A "Wooden bookcase"): a walnut cabinet with a plank for
 * each tier, covers standing face out on it, and a brass nameplate in the tier's colour with its icon
 * and count. What you stamped waits in a record crate on top. A shelf too full for its plank folds its
 * last covers into a leaning "+N" stack, which opens the shelf to scroll along.
 *
 * Only drawing: what moves where is the card's (`RankingCard.tsx`), through the same drop zones and
 * covers as its banded rows, so dragging and the arrow keys work the same in both.
 */

/** Where a drag over the card would put the item. */
export interface DropAt {
	tier: string
	beforeId: string | null
}

type ZoneProps = {
	onDragOver: (e: DragEvent) => void
	onDragLeave: (e: DragEvent) => void
	onDrop: (e: DragEvent) => void
}

/** The zone the crate is: covers dropped there go back to waiting. */
export const QUEUE = 'queue'

/** Room inside a shelf, either side, and between covers. */
const PAD = 14
const GAP = 12
/** The most covers the crate draws. More, and "+N" opens the whole queue beside it. */
export const CRATE_SHOWS = 10

const swallow = (e: SyntheticEvent) => e.stopPropagation()

/** How many covers fit on one plank, from the cabinet's width; every cover until it is measured. */
function useCapacity(coverPx: number): [React.RefObject<HTMLDivElement | null>, number] {
	const ref = useRef<HTMLDivElement>(null)
	const [cap, setCap] = useState(Number.POSITIVE_INFINITY)
	useEffect(() => {
		const el = ref.current
		if (!el || typeof ResizeObserver === 'undefined') return
		const measure = () => setCap(Math.max(2, Math.floor((el.clientWidth - PAD * 2 + GAP) / (coverPx + GAP))))
		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(el)
		return () => observer.disconnect()
	}, [coverPx])
	return [ref, cap]
}

/** One sleeve in a "+N" stack: the picture only. */
function Sleeve({ entry, shape }: { entry: SourceEntry; shape: SourceKind['shape'] }) {
	const url = useItemCover(entry, shape)
	return (
		<span className="lb-shelf__sleeve">
			<img src={url} alt="" draggable={false} loading="lazy" />
		</span>
	)
}

export function ShelfView({
	bands,
	queue,
	kind,
	coverPx,
	dropAt,
	zoneProps,
	renderCover,
	tierMenu,
	hasStamps,
}: {
	bands: readonly Band[]
	queue: readonly SourceEntry[]
	kind: SourceKind
	/** A cover's width, from the ranking's cover shape. */
	coverPx: number
	dropAt: DropAt | null
	zoneProps: (zone: string) => ZoneProps
	/** The card's own cover, its handlers and badge on it, for an entry in a zone. */
	renderCover: (entry: SourceEntry, zone: string, z?: number) => ReactNode
	/** A tier's ⋯ knob and its menu. */
	tierMenu: (band: Band, index: number) => ReactNode
	/** Whether anything stamps: without the randomizer there is no crate. */
	hasStamps: boolean
}) {
	const [interior, cap] = useCapacity(coverPx)
	const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
	const toggle = (tierId: string, on: boolean) => {
		const next = new Set(open)
		if (on) next.add(tierId)
		else next.delete(tierId)
		setOpen(next)
	}
	const caret = <span className="lb-rank__caret lb-shelf__caret" aria-hidden="true" />
	// A full crate opens into the whole queue, laid out flat under it, so every cover can be dragged.
	const [crateOpen, setCrateOpen] = useState(false)
	const spills = queue.length > CRATE_SHOWS
	const spilled = spills && crateOpen
	const crate = spilled ? [] : queue.slice(0, CRATE_SHOWS)

	return (
		<div className="lb-shelf">
			{hasStamps && (
				<div className="lb-shelf__top">
					<p className="lb-shelf__hint">Newly stamped {kind.noun} land in the crate. Drag one onto any shelf.</p>
					<section
						className={dropAt?.tier === QUEUE ? 'lb-shelf__crate lb-shelf__crate--target' : 'lb-shelf__crate'}
						aria-label={`Rank queue, ${queue.length} waiting`}
						{...zoneProps(QUEUE)}
					>
						<div className="lb-shelf__crate-back" />
						<div className="lb-shelf__crate-items" role={spilled ? undefined : 'list'} aria-label={spilled ? undefined : 'Rank queue'}>
							{crate.map((entry, i) => renderCover(entry, QUEUE, crate.length - i))}
							{queue.length === 0 && <span className="lb-shelf__crate-empty">Crate empty: new stamps land here</span>}
						</div>
						<div className="lb-shelf__crate-front">
							<span className="lb-shelf__crate-label">Rank queue · {queue.length}</span>
						</div>
						{spills && (
							<button
								type="button"
								className="lb-shelf__crate-more"
								aria-expanded={spilled}
								aria-label={spilled ? 'Put the queue back in the crate' : `Show all ${queue.length} waiting`}
								onPointerDown={swallow}
								onClick={() => setCrateOpen(!spilled)}
							>
								{spilled ? 'Close' : `+${queue.length - CRATE_SHOWS}`}
							</button>
						)}
					</section>
				</div>
			)}
			{hasStamps && spilled && (
				<section className="lb-shelf__spill" aria-label={`Rank queue, all ${queue.length}`} {...zoneProps(QUEUE)}>
					<div className="lb-shelf__spill-list" role="list" aria-label="Rank queue">
						{queue.map((entry) => renderCover(entry, QUEUE))}
					</div>
				</section>
			)}
			<div className="lb-shelf__cabinet">
				<div className="lb-shelf__crown" />
				<div className="lb-shelf__carcass" ref={interior}>
					{bands.map((band, i) => {
						const { tier, items } = band
						const n = items.length
						const expanded = open.has(tier.id) && n > cap
						const folds = n > cap && !expanded
						const shown = folds ? items.slice(0, cap - 1) : items
						const hidden = folds ? items.slice(cap - 1) : []
						const target = dropAt?.tier === tier.id
						return (
							<section
								key={tier.id}
								className={`lb-shelf__bay${target ? ' lb-shelf__bay--target' : ''}`}
								style={tierStyle(tier, i)}
								aria-label={`${tier.name} tier`}
								{...zoneProps(tier.id)}
							>
								<div className={expanded ? 'lb-shelf__row lb-shelf__row--open' : 'lb-shelf__row'} role="list" aria-label={tier.name}>
									{shown.map((entry) => (
										<Fragment key={entry.id}>
											{target && dropAt?.beforeId === entry.id && caret}
											{renderCover(entry, tier.id)}
										</Fragment>
									))}
									{hidden.length > 0 && (
										<button
											type="button"
											className={target && dropAt?.beforeId === null ? 'lb-shelf__stack lb-shelf__stack--target' : 'lb-shelf__stack'}
											aria-label={`Show ${hidden.length} more on ${tier.name}`}
											title={hidden.map((e) => e.title).join(', ')}
											onPointerDown={swallow}
											onClick={() => toggle(tier.id, true)}
										>
											{hidden
												.slice(0, 3)
												.reverse()
												.map((entry) => (
													<Sleeve key={entry.id} entry={entry} shape={kind.shape} />
												))}
											<span className="lb-shelf__stack-n">+{hidden.length}</span>
										</button>
									)}
									{!folds && target && dropAt?.beforeId === null && n > 0 && caret}
									{expanded && (
										<button type="button" className="lb-shelf__fold" aria-label={`Fold ${tier.name}`} onPointerDown={swallow} onClick={() => toggle(tier.id, false)}>
											<ChevronLeft size={14} aria-hidden />
											<span>Fold</span>
										</button>
									)}
									{n === 0 && <span className="lb-shelf__empty">Drop {kind.noun} here</span>}
								</div>
								<div className="lb-shelf__plank">
									<div className="lb-shelf__plate">
										<span className="lb-shelf__screw" />
										<span className="lb-shelf__enamel">
											<TierIcon id={tier.icon} size={13} />
											<span className="lb-shelf__plate-name">{tier.name}</span>
											<span className="lb-shelf__plate-n">{n}</span>
										</span>
										<span className="lb-shelf__screw" />
									</div>
									<span className="lb-rank__grow" />
									{tierMenu(band, i)}
								</div>
							</section>
						)
					})}
				</div>
				<div className="lb-shelf__plinth" />
			</div>
		</div>
	)
}
