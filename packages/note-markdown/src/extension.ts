import { defineNode, type Extension } from '@lifeboard/node-kit'
import { NotepadText } from 'lucide-react'
import { noteNodeDefinition } from './definition'

/**
 * The markdown note, packaged as an extension — the first node type extracted from the host, and the
 * template for every renderer that follows (an org-mode note would be its own package contributing
 * `node.org` the same way; converting between the two is an explicit command, not a renderer switch,
 * because the format is the data contract).
 *
 * The app registers this from its composition root (`apps/web/src/extensions.ts`). Toggling it off in
 * Settings hides the note tool and menu entries; existing notes keep rendering, because enablement
 * never touches the schema.
 */
export const markdownNoteExtension: Extension = {
	id: 'lifeboard.note-markdown',
	name: 'Markdown notes',
	description: 'Prose notes written in markdown — headings, lists, tasks, images and inline expressions.',
	icon: NotepadText,
	version: '0.1.0',
	author: 'Lifeboard',
	nodes: [defineNode(noteNodeDefinition)],
}
