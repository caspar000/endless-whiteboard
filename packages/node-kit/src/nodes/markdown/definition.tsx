import { T } from 'tldraw'
import { emptyPropsMigrations } from '../../migrations'
import type { NodeDefinition } from '../../registry'
import { MarkdownNodeComponent } from './MarkdownNodeComponent'

export const MARKDOWN_NODE_TYPE = 'node.markdown'

export interface MarkdownNodeProps {
	/** Source of truth is the markdown *string* — portable, diffable, plugin/AI-friendly (§4.6). */
	md: string
}

export const markdownNodeDefinition: NodeDefinition<MarkdownNodeProps> = {
	type: MARKDOWN_NODE_TYPE,
	label: 'Markdown',
	icon: 'M',
	props: {
		md: T.string,
	},
	migrations: emptyPropsMigrations(),
	defaultProps: () => ({ md: '' }),
	defaultSize: { w: 320, h: 220 },
	component: MarkdownNodeComponent,
	canEdit: true,
	// No `extractFacts`: prose exposes no structured data, so rollups correctly ignore it.
}

/** First heading or line of prose. Used for the board's node list and a11y labels. */
export function markdownTitle(md: string): string {
	for (const line of md.split('\n')) {
		const text = line
			.replace(/^#{1,6}\s+/, '')
			.replace(/^[-*+]\s+(\[[ xX]\]\s+)?/, '')
			.replace(/^>\s?/, '')
			.replace(/[*_`~]/g, '')
			.trim()
		if (text) return text
	}
	return ''
}
