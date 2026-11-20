import { RedditIcon, XIcon } from './icons'
import type { FeedProvider } from './registry'

/**
 * Platforms on the way: shown on the sources panel, so it is plain they are planned, and nothing can be
 * added with them yet. Each becomes a provider like YouTube's.
 */
function comingSoon(id: string, name: string, icon: FeedProvider['icon']): FeedProvider {
	return {
		id,
		name,
		icon,
		available: false,
		inputLabel: '',
		placeholder: '',
		resolve: async () => ({ error: `${name} is coming soon.` }),
		parse: () => null,
	}
}

export const redditProvider = comingSoon('reddit', 'Reddit', RedditIcon)
export const xProvider = comingSoon('x', 'X', XIcon)
