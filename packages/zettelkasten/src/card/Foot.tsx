import { stopEventPropagation, useEditor, useValue } from '@lifeboard/canvas'
import { Hash, Link2, Quote, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { boxLinks, isSource, shapeByZid, type CardShape, type ChipKind } from '../box'
import { goToCard, goToKeyword } from '../go'
import { inlineLinks } from '../links'
import { nameOf } from './text'

const ICON = { link: Link2, keyword: Hash, cite: Quote } as const

/** What a source is called on a chip and in lists: its author and year, else its title. */
export function sourceLabel(author: string, title: string, year: string): string {
	const who = author.split(/[,;]| and /)[0]?.trim() ?? ''
	return [who || title, year].filter(Boolean).join(' ') || 'Untitled source'
}

/** A note's number in a list, which goes to it. */
export function NoteNumber({ zid }: { zid: string }) {
	const editor = useEditor()
	return (
		<button
			type="button"
			className="lb-zlink"
			data-zid={zid}
			onPointerDown={stopEventPropagation}
			onClick={(event) => {
				event.stopPropagation()
				goToCard(editor, zid)
			}}
		>
			{zid}
		</button>
	)
}

/**
 * One chip in a card's footer: a link, a keyword or a source. Pressing it goes there (go.ts). In the
 * stack's front card it can also be taken off (`onRemove`); a link written in the text can't be, as it
 * is the text's to keep.
 */
export function Chip({
	kind,
	value,
	label,
	title,
	missing = false,
	onRemove,
}: {
	kind: ChipKind
	value: string
	label: string
	title?: string
	missing?: boolean
	onRemove?: () => void
}) {
	const editor = useEditor()
	const Icon = ICON[kind]
	return (
		<span
			className={missing ? 'lb-zchip lb-zchip--missing' : 'lb-zchip'}
			data-kind={kind}
			// Where it goes, for a surface that follows it its own way (the chain turns there).
			data-zid={kind === 'keyword' || missing ? undefined : value}
		>
			<button
				type="button"
				className="lb-zchip__go"
				title={title}
				onPointerDown={stopEventPropagation}
				onClick={(event) => {
					event.stopPropagation()
					if (kind === 'keyword') goToKeyword(editor, value)
					else goToCard(editor, value)
				}}
			>
				<Icon aria-hidden="true" />
				<span className="lb-zchip__label">{label}</span>
			</button>
			{onRemove && (
				<button
					type="button"
					className="lb-zchip__remove"
					aria-label={`Take off ${label}`}
					onPointerDown={stopEventPropagation}
					onClick={(event) => {
						event.stopPropagation()
						onRemove()
					}}
				>
					<X aria-hidden="true" />
				</button>
			)}
		</span>
	)
}

/**
 * A note's footer: where it links, the keywords it is filed under, the sources it cites, and, dimmed,
 * which notes link to it. `add` is the stack's **+**, and `onRemove` its way of taking a chip off; both
 * only on the card in front.
 */
export function NoteFoot({
	shape,
	add,
	onRemove,
}: {
	shape: CardShape
	add?: ReactNode
	onRemove?: (kind: ChipKind, value: string) => void
}) {
	const editor = useEditor()
	const { zid, richText, links = [], keywords = [], cites = [] } = shape.props
	const linkedFrom = useValue('lifeboard:zettel-linked-from', () => boxLinks(editor).linkedFrom.get(zid) ?? [], [editor, zid])
	// Every note this one points at, written or added, each once; only the added ones can be taken off.
	const written = inlineLinks(richText)
	const pointsAt = [...written, ...links.filter((target) => !written.includes(target))].filter((target) => target !== zid)
	const chips = useValue(
		'lifeboard:zettel-chips',
		() => ({
			links: pointsAt.map((target) => {
				const other = shapeByZid(editor, target)
				const name = !other ? '' : isSource(other) ? sourceLabel(other.props.author, other.props.title, other.props.year) : nameOf(other.props.richText)
				return { target, name, missing: !other }
			}),
			cites: cites.map((source) => {
				const other = shapeByZid(editor, source)
				return {
					source,
					label: isSource(other) ? sourceLabel(other.props.author, other.props.title, other.props.year) : '',
					missing: !isSource(other),
				}
			}),
		}),
		[editor, pointsAt.join(' '), cites.join(' ')]
	)
	if (!pointsAt.length && !keywords.length && !cites.length && !linkedFrom.length && !add) return null
	return (
		<div className="lb-zcard__foot">
			<div className="lb-zcard__chips">
				{chips.links.map(({ target, name, missing }) => (
					<Chip
						key={`link:${target}`}
						kind="link"
						value={target}
						label={target}
						title={missing ? `There is no ${target} in this box` : name || target}
						missing={missing}
						onRemove={onRemove && links.includes(target) && !written.includes(target) ? () => onRemove('link', target) : undefined}
					/>
				))}
				{keywords.map((keyword) => (
					<Chip
						key={`keyword:${keyword}`}
						kind="keyword"
						value={keyword}
						label={keyword}
						title={`In the index under ${keyword}`}
						onRemove={onRemove ? () => onRemove('keyword', keyword) : undefined}
					/>
				))}
				{chips.cites.map(({ source, label, missing }) => (
					<Chip
						key={`cite:${source}`}
						kind="cite"
						value={source}
						label={label ? `${source} ${label}` : source}
						title={missing ? `There is no ${source} in this box` : label}
						missing={missing}
						onRemove={onRemove ? () => onRemove('cite', source) : undefined}
					/>
				))}
				{add}
			</div>
			{linkedFrom.length > 0 && (
				<div className="lb-zcard__from">
					Linked from{' '}
					{linkedFrom.map((from, i) => (
						<span key={from}>
							{i > 0 && ', '}
							<NoteNumber zid={from} />
						</span>
					))}
				</div>
			)}
		</div>
	)
}
