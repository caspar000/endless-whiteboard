import { DEFAULT_LAYOUT, LAYOUT_FIELDS, type LayoutConfig } from './layoutDefaults'

/**
 * Every setting of the maze (layoutDefaults.ts, `LAYOUT_FIELDS`), grouped: a slider and a number for
 * each number (the slider has ends; the number typed doesn't), a menu for each choice. Shared by
 * Settings (under Advanced) and the layout tuner, so the two show the same settings. A setting off
 * its default is marked.
 */
export function LayoutFields({ config, onChange }: { config: LayoutConfig; onChange: (patch: Partial<LayoutConfig>) => void }) {
	const groups = [...new Set(LAYOUT_FIELDS.map((f) => f.group))]
	return (
		<>
			{groups.map((group) => (
				<section key={group} className="lb-tuner__group">
					<h4>{group}</h4>
					{LAYOUT_FIELDS.filter((f) => f.group === group).map((field) => {
						const changed = config[field.key] !== DEFAULT_LAYOUT[field.key]
						const row = `lb-tuner__row${changed ? ' lb-tuner__row--changed' : ''}`
						if ('min' in field) {
							const value = config[field.key]
							return (
								<label key={field.key} className={row} title={field.hint}>
									<span>{field.label}</span>
									<input type="range" min={field.min} max={field.max} step={field.step} value={value} onChange={(e) => onChange({ [field.key]: Number(e.target.value) })} />
									<input
										type="number"
										value={value}
										// Typed, any number goes, past the slider's ends too.
										step="any"
										onChange={(e) => e.target.value !== '' && Number.isFinite(Number(e.target.value)) && onChange({ [field.key]: Number(e.target.value) })}
									/>
								</label>
							)
						}
						return (
							<label key={field.key} className={row} title={field.hint}>
								<span>{field.label}</span>
								<select value={config[field.key]} onChange={(e) => onChange({ [field.key]: e.target.value } as Partial<LayoutConfig>)}>
									{field.options.map((o) => (
										<option key={o.value} value={o.value}>
											{o.label}
										</option>
									))}
								</select>
							</label>
						)
					})}
				</section>
			))}
		</>
	)
}
