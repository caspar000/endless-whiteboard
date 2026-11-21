import { useValue } from '@lifeboard/canvas'
import { offeredItemSources, resolveItemSource, sourceKey } from './itemSources'

/**
 * A menu of every source the enabled extensions offer, grouped as each source groups its choices:
 * "Feeds: Categories", "Syllabi: /mu/core". What a ranking ranks and what a backlog collects are
 * chosen here, so both list the same things the same way.
 *
 * `exclude` leaves out sources by id: a ranking can't rank rankings, which could rank it.
 */
export function SourceSelect({
	id,
	value,
	onChange,
	exclude = [],
	placeholder = 'Choose a source…',
	autoFocus,
}: {
	id?: string
	/** A source key, or '' for none yet. */
	value: string
	onChange: (key: string) => void
	exclude?: readonly string[]
	placeholder?: string
	autoFocus?: boolean
}) {
	const offered = useValue(
		'lifeboard:source-select',
		() =>
			offeredItemSources()
				.filter((s) => !exclude.includes(s.id))
				.map((s) => ({ id: s.id, label: s.label, choices: s.choices() })),
		[exclude.join()]
	)
	const listed = offered.some((s) => s.choices.some((c) => sourceKey(s.id, c.id) === value))
	return (
		<select id={id} className="lb-source-select" value={value} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)}>
			{!value && (
				<option value="" disabled>
					{placeholder}
				</option>
			)}
			{value && !listed && <option value={value}>{resolveItemSource(value).name}</option>}
			{offered.flatMap((source) =>
				[...new Set(source.choices.map((c) => c.group))].map((group) => (
					<optgroup key={`${source.id}/${group}`} label={group ? `${source.label}: ${group}` : source.label}>
						{source.choices
							.filter((c) => c.group === group)
							.map((c) => (
								<option key={c.id} value={sourceKey(source.id, c.id)}>
									{c.label}
								</option>
							))}
					</optgroup>
				))
			)}
		</select>
	)
}
