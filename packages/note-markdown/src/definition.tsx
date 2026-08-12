import {
	createShapePropsMigrationIds,
	createShapePropsMigrationSequence,
	type NodeDefinition,
} from '@lifeboard/node-kit'
import { NotepadText } from 'lucide-react'
import { T } from 'tldraw'
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

export const NOTE_MIN_HEIGHT = 44

const versions = createShapePropsMigrationIds('node.markdown', { AddAutoHeight: 1 })

export const noteNodeDefinition: NodeDefinition<NoteNodeProps> = {
	type: NOTE_NODE_TYPE,
	label: 'Note',
	icon: 'N',
	// A written page, not a sticky — the sticky-note glyph belongs to tldraw's own sticky tool.
	toolbarIcon: NotepadText,
	// `m` for "markdown": `n` is tldraw's sticky note, and taking its letter meant two tools claimed
	// one key. Checked against tldraw's own bindings (`r` and `g` are taken too).
	kbd: 'm',
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
	// A note's name is its first heading. `ShapeUtil.getText` can't find it — the markdown lives in
	// our own props — so the definition supplies it as the first rung of the `shapeLabel` ladder.
	getLabel: (shape) => noteTitle(shape.props.md),
	// No `extractFacts`: prose exposes no structured *values*. Its properties come from `shape.meta`
	// like every other shape's, which is the whole point of the property system.
}

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
