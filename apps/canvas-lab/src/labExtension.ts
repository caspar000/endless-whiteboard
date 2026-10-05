import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

/**
 * A stand-in for an app's own TipTap extension (Lifeboard's `{…}` helper is one): typing `@` opens a
 * small menu next to the caret. It proves extensions passed through `textOptions` reach every label.
 */
export const labMenuExtension = Extension.create({
	name: 'labMenu',
	addProseMirrorPlugins() {
		return [
			new Plugin({
				key: new PluginKey('labMenu'),
				view(view) {
					const menu = document.createElement('div')
					menu.className = 'lab-menu'
					menu.textContent = 'Lab menu'
					Object.assign(menu.style, {
						position: 'fixed',
						padding: '4px 8px',
						background: 'white',
						border: '1px solid #ccc',
						font: '12px sans-serif',
						zIndex: '1000',
					})
					const update = () => {
						const { $from, empty } = view.state.selection
						const before = $from.parent.textBetween(0, $from.parentOffset)
						const open = empty && before.endsWith('@')
						if (!open) return menu.remove()
						const caret = view.coordsAtPos($from.pos)
						menu.style.left = `${caret.left}px`
						menu.style.top = `${caret.bottom + 4}px`
						if (!menu.isConnected) document.body.appendChild(menu)
					}
					update()
					return { update, destroy: () => menu.remove() }
				},
			}),
		]
	},
})
