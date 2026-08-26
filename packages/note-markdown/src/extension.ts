import { defineNode, type Extension } from '@lifeboard/node-kit'
import { NotepadText } from 'lucide-react'
import { noteNodeDefinition } from './definition'
import { linkDropImport } from './linkDrop'

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
	details: [
		'Adds the note: a card you write prose in. It is markdown all the way down — headings, lists, task boxes, links, quotes and images — and what you type is what is stored, so a note is portable text rather than a proprietary blob.',
		'Notes carry properties like any other shape, so a note can hold a price, a date or a rating and be counted by a table without being copied anywhere. Type `{` in a note to drop in an inline expression that stays live.',
		'Dropping or pasting a link makes a note that carries it as a Link property — so a page you saved can be counted, filed and put in a view, rather than sitting in a card that only looks at you.',
		'Turning this off removes the note tool and its menu entries, and returns dropped links to the canvas\u2019s own bookmark card. Notes already on your boards keep rendering and stay editable.',
	],
	icon: NotepadText,
	version: '0.1.0',
	author: 'Lifeboard',
	nodes: [defineNode(noteNodeDefinition)],
	contentImports: [linkDropImport],
}
