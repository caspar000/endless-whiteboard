import { useId, type CSSProperties, type ReactNode } from 'react'
import { STAMPS, postmarkDate, type StampKind } from './model'

/**
 * A round, dated postmark: a ring, the word round the top, the date round the bottom, a small mark in
 * the middle and wavy cancel lines trailing off to the left. Design 2B of DARK-6.
 *
 * Drawn twice, the same paths both times: first thick in the board's own background colour, then in
 * ink on top. That first pass is a halo, the same one the board's text wears (`--tl-text-outline`
 * uses the same colour), so a stamp reads over any cover, white on the light board and dark on the
 * dark one.
 */

const MARKS: Record<StampKind, ReactNode> = {
	liked: <path d="M0 6C-7 1.5-8-3.5-4.5-5.5-2.4-6.6-.6-5.6 0-3.8.6-5.6 2.4-6.6 4.5-5.5 8-3.5 7 1.5 0 6Z" strokeWidth={1.6} strokeLinejoin="round" />,
	disliked: <path d="M-5-5 5 5M5-5-5 5" strokeWidth={2} strokeLinecap="round" />,
	unsure: (
		<>
			<path d="M-3.6-2.8C-3.6-6.4 3.8-6.6 3.8-2.6 3.8 0 0 .3 0 3" strokeWidth={1.8} strokeLinecap="round" />
			<circle cy={6.4} r={1.15} fill="currentColor" stroke="none" />
		</>
	),
}

/** Where the ring's middle is in the full postmark's 120×68 box. The pile places stamps by it. */
export const POSTMARK_CENTRE = { x: 86 / 120, y: 0.5 }

const CX = 86
const CY = 34

function wave(y: number, x0: number) {
	let d = `M55 ${y}`
	for (let x = 55; x > x0; x -= 8) d += ' q-2 -2.6 -4 0 t-4 0'
	return <path d={d} strokeWidth={1.3} strokeLinecap="round" />
}

export function Postmark({
	kind,
	date,
	mini = false,
	className,
	style,
}: {
	kind: StampKind
	date: string
	/** The ring alone, for the stamp menu. */
	mini?: boolean
	className?: string
	style?: CSSProperties
}) {
	const id = useId().replace(/[^a-zA-Z0-9]/g, '')
	const stamp = STAMPS[kind]
	const body = (pass: 'halo' | 'ink') => (
		<g className={`lb-rand-pm__${pass}`} fill="none" stroke="currentColor" filter={pass === 'ink' ? `url(#${id}ink)` : undefined}>
			{!mini && (
				<>
					{wave(25, 10)}
					{wave(34, 3)}
					{wave(43, 15)}
				</>
			)}
			<circle cx={CX} cy={CY} r={31} strokeWidth={1.8} />
			<circle cx={CX} cy={CY} r={29} strokeWidth={0.6} />
			<circle cx={CX} cy={CY} r={18} strokeWidth={1} />
			<circle cx={CX - 25} cy={CY} r={1.1} fill="currentColor" stroke="none" />
			<circle cx={CX + 25} cy={CY} r={1.1} fill="currentColor" stroke="none" />
			<g transform={`translate(${CX} ${CY})`}>{MARKS[kind]}</g>
			<g fill="currentColor" stroke={pass === 'halo' ? 'currentColor' : 'none'} fontFamily="Inter, 'Helvetica Neue', Arial, sans-serif" fontWeight={600} fontSize={7} letterSpacing={1.1} textAnchor="middle">
				<text>
					<textPath href={`#${id}t`} startOffset="50%">
						{stamp.word}
					</textPath>
				</text>
				<text>
					<textPath href={`#${id}b`} startOffset="50%">
						{postmarkDate(date)}
					</textPath>
				</text>
			</g>
		</g>
	)
	return (
		<svg
			className={className}
			style={{ ...style, color: stamp.ink }}
			viewBox={mini ? '52 0 68 68' : '0 0 120 68'}
			aria-hidden="true"
			focusable="false"
		>
			<defs>
				<path id={`${id}t`} d={`M${CX - 22.4} ${CY}A22.4 22.4 0 0 1 ${CX + 22.4} ${CY}`} />
				<path id={`${id}b`} d={`M${CX - 26.8} ${CY}A26.8 26.8 0 0 0 ${CX + 26.8} ${CY}`} />
				{/* Faint grain and slightly ragged edges, for rubber-stamp ink. */}
				<filter id={`${id}ink`} x="-5%" y="-5%" width="110%" height="110%">
					<feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves={2} seed={7} result="n" />
					<feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -1.3 0 0 0 1.45" result="g" />
					<feComposite in="SourceGraphic" in2="g" operator="in" result="ink" />
					<feDisplacementMap in="ink" in2="n" scale={0.9} xChannelSelector="R" yChannelSelector="G" />
				</filter>
			</defs>
			{!mini && body('halo')}
			{body('ink')}
		</svg>
	)
}
