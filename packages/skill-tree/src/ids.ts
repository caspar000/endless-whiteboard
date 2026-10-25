/**
 * A stable global id from a title: a readable slug plus a short random suffix, so two items called
 * "Tragedies" never collide. The id outlives renames; it is only derived from the title once.
 */
export function makeItemId(title: string, prefix = '', random: () => number = Math.random): string {
	const slug =
		title
			.toLowerCase()
			.normalize('NFKD')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 40) || 'item'
	const suffix = Math.floor(random() * 36 ** 4)
		.toString(36)
		.padStart(4, '0')
	return `${prefix}${slug}-${suffix}`
}

/** Today in local time, as a `date` property stores it. */
export function todayIso(now: Date = new Date()): string {
	const month = String(now.getMonth() + 1).padStart(2, '0')
	const day = String(now.getDate()).padStart(2, '0')
	return `${now.getFullYear()}-${month}-${day}`
}
