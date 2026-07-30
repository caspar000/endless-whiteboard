import { T } from 'tldraw'
import { createShapePropsMigrationIds, createShapePropsMigrationSequence } from '../../migrations'
import type { NodeDefinition } from '../../registry'
import { MarkdownNodeComponent } from './MarkdownNodeComponent'

/**
 * The note — the default thing a double-click on empty canvas creates.
 *
 * The persisted shape type id stays `node.markdown` even though the product calls this a "Note".
 * Renaming a persisted type id would require a store-scoped migration rewriting every record, for a
 * purely cosmetic gain; keeping it means every note that already exists simply *is* a note, with no
 * migration at all.
 */
export const NOTE_NODE_TYPE = 'node.markdown'

/** @deprecated Use {@link NOTE_NODE_TYPE}. Kept so existing imports keep compiling. */
export const MARKDOWN_NODE_TYPE = NOTE_NODE_TYPE

export interface NoteNodeProps {
	/** Source of truth is the markdown *string* — portable, diffable, plugin/AI-friendly (§4.6). */
	md: string
	/**
	 * `true` → `h` is a *cache* of the measured content height, rewritten as you type with
	 * `history: 'ignore'`. `false` → the user pinned a height by dragging a vertical handle, and the
	 * note scrolls internally instead of growing.
	 */
	autoHeight: boolean
}

/** @deprecated Use {@link NoteNodeProps}. */
export type MarkdownNodeProps = NoteNodeProps

export const NOTE_MIN_HEIGHT = 44

const versions = createShapePropsMigrationIds('node.markdown', { AddAutoHeight: 1 })

export const noteNodeDefinition: NodeDefinition<NoteNodeProps> = {
	type: NOTE_NODE_TYPE,
	label: 'Note',
	icon: 'N',
	props: {
		md: T.string,
		autoHeight: T.boolean,
	},
	/**
	 * The repo's first real props migration — exactly what the §7 guardrail exists for.
	 *
	 * It adds `autoHeight: false`, deliberately *not* `true`: every note that already exists has a
	 * height the user drew with the box tool, and must keep looking precisely as it does. Only notes
	 * created from now on (via `defaultProps`) grow with their content.
	 */
	migrations: createShapePropsMigrationSequence({
		sequence: [
			{
				id: versions.AddAutoHeight,
				up(props) {
					props.autoHeight = false
				},
			},
		],
	}),
	defaultProps: () => ({ md: '', autoHeight: true }),
	// Short by default: a new note is one empty line, and auto-height grows it from there.
	defaultSize: { w: 360, h: NOTE_MIN_HEIGHT },
	autoHeight: { minHeight: NOTE_MIN_HEIGHT },
	component: MarkdownNodeComponent,
	canEdit: true,
	// No `extractFacts` yet — prose exposes no structured data. Phase 2 gives every shape properties.
}

/** @deprecated Use {@link noteNodeDefinition}. */
export const markdownNodeDefinition = noteNodeDefinition

/** First heading or line of prose. Used for the board's node list and a11y labels. */
export function noteTitle(md: string): string {
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

/** @deprecated Use {@link noteTitle}. */
export const markdownTitle = noteTitle
