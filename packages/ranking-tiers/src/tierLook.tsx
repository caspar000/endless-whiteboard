import {
	BookOpen,
	Clock,
	Coffee,
	Crown,
	Disc3,
	Film,
	Flame,
	Gamepad2,
	Headphones,
	Heart,
	Moon,
	Music,
	Repeat,
	Snowflake,
	Sparkles,
	Star,
	ThumbsDown,
	ThumbsUp,
	Trophy,
	Zap,
	type LucideIcon,
} from 'lucide-react'
import type { CSSProperties } from 'react'
import { TIER_COLORS, plateColor, tierColor, type Tier } from './model'

/**
 * How a tier can look (DARK-14): a short set of icons to tell its rows apart at a glance, by the name a
 * tier stores. Kept small on purpose, picked from a grid in the tier's menu: these are labels, not a
 * board's icon.
 */
export const TIER_ICONS: ReadonlyArray<{ id: string; label: string; Icon: LucideIcon }> = [
	{ id: 'flame', label: 'Flame', Icon: Flame },
	{ id: 'repeat', label: 'Repeat', Icon: Repeat },
	{ id: 'clock', label: 'Clock', Icon: Clock },
	{ id: 'moon', label: 'Moon', Icon: Moon },
	{ id: 'star', label: 'Star', Icon: Star },
	{ id: 'heart', label: 'Heart', Icon: Heart },
	{ id: 'sparkles', label: 'Sparkles', Icon: Sparkles },
	{ id: 'trophy', label: 'Trophy', Icon: Trophy },
	{ id: 'crown', label: 'Crown', Icon: Crown },
	{ id: 'thumbs-up', label: 'Thumbs up', Icon: ThumbsUp },
	{ id: 'thumbs-down', label: 'Thumbs down', Icon: ThumbsDown },
	{ id: 'zap', label: 'Lightning', Icon: Zap },
	{ id: 'music', label: 'Music', Icon: Music },
	{ id: 'disc', label: 'Record', Icon: Disc3 },
	{ id: 'headphones', label: 'Headphones', Icon: Headphones },
	{ id: 'book', label: 'Book', Icon: BookOpen },
	{ id: 'film', label: 'Film', Icon: Film },
	{ id: 'game', label: 'Game', Icon: Gamepad2 },
	{ id: 'coffee', label: 'Coffee', Icon: Coffee },
	{ id: 'snowflake', label: 'Snowflake', Icon: Snowflake },
]

/** A tier's icon, or nothing for a tier without one (or one this build doesn't know). */
export function TierIcon({ id, size = 14 }: { id: string; size?: number }) {
	const Icon = TIER_ICONS.find((i) => i.id === id)?.Icon
	return Icon ? <Icon size={size} aria-hidden className="lb-rank__tier-icon" /> : null
}

/** A tier's row colours, as the CSS reads them: its background and its border, when it has them. */
export function tierStyle(tier: Pick<Tier, 'color' | 'border'>, index: number): CSSProperties {
	const style: Record<string, string> = { '--lb-tier-plate': plateColor(tier, index) }
	const color = tierColor(tier.color)
	const border = tierColor(tier.border)
	if (color) style['--lb-tier-bg'] = color
	if (border) style['--lb-tier-border'] = border
	return style as CSSProperties
}

/** One row of colour swatches, none first, for a tier's background or border. */
export function Swatches({ label, value, onPick }: { label: string; value: string; onPick: (id: string) => void }) {
	return (
		<div className="lb-rank__swatches" role="radiogroup" aria-label={label}>
			<button type="button" role="radio" aria-checked={!value} aria-label="None" title="None" className="lb-rank__swatch lb-rank__swatch--none" onClick={() => onPick('')} />
			{TIER_COLORS.map((c) => (
				<button
					key={c.id}
					type="button"
					role="radio"
					aria-checked={value === c.id}
					aria-label={c.label}
					title={c.label}
					className="lb-rank__swatch"
					style={{ background: c.value }}
					onClick={() => onPick(c.id)}
				/>
			))}
		</div>
	)
}

/** The icons as a grid, none first. */
export function IconGrid({ value, onPick }: { value: string; onPick: (id: string) => void }) {
	return (
		<div className="lb-rank__icon-grid" role="radiogroup" aria-label="Icon">
			<button type="button" role="radio" aria-checked={!value} aria-label="No icon" title="No icon" className="lb-rank__icon-pick lb-rank__icon-pick--none" onClick={() => onPick('')}>
				—
			</button>
			{TIER_ICONS.map(({ id, label, Icon }) => (
				<button key={id} type="button" role="radio" aria-checked={value === id} aria-label={label} title={label} className="lb-rank__icon-pick" onClick={() => onPick(id)}>
					<Icon size={14} aria-hidden />
				</button>
			))}
		</div>
	)
}
