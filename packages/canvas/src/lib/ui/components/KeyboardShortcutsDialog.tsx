import { TLUiMenuChild } from '../hooks/menuHelpers'
import { useKeyboardShortcutsSchema } from '../hooks/useKeyboardShortcutsSchema'
import { useReadonly } from '../hooks/useReadonly'
import { TLUiTranslationKey } from '../hooks/useTranslation/TLUiTranslationKey'
import { useTranslation } from '../hooks/useTranslation/useTranslation'
import * as Dialog from './primitives/Dialog'
import { Kbd } from './primitives/Kbd'
import { TLUiKeyboardShortcutsDialogProps } from '../hooks/useTldrawUiComponents'

/**
 * The keyboard shortcuts dialog: a title and close button around `children`, by default
 * `DefaultKeyboardShortcutsDialogContent` (the shortcuts of every action and tool).
 *
 * @public
 */
export function DefaultKeyboardShortcutsDialog({ children }: TLUiKeyboardShortcutsDialogProps) {
	const msg = useTranslation()
	return (
		<>
			<Dialog.Header className="tlui-shortcuts-dialog__header">
				<Dialog.Title>{msg('shortcuts-dialog.title')}</Dialog.Title>
				<Dialog.CloseButton />
			</Dialog.Header>
			<Dialog.Body className="tlui-shortcuts-dialog__body">
				{children ?? <DefaultKeyboardShortcutsDialogContent />}
			</Dialog.Body>
			<div className="tlui-dialog__scrim" />
		</>
	)
}

/** The shortcuts of every action and tool, grouped. @public */
export function DefaultKeyboardShortcutsDialogContent() {
	const msg = useTranslation()
	const isReadonly = useReadonly()
	const shortcutsItems = useKeyboardShortcutsSchema()

	function getKeyboardShortcutItem(item: TLUiMenuChild) {
		if (!item) return null
		if (isReadonly && !item.readonlyOk) return null

		switch (item.type) {
			case 'group': {
				return (
					<div className="tlui-shortcuts-dialog__group" key={item.id}>
						<h2 className="tlui-shortcuts-dialog__group__title">
							{msg(item.id as TLUiTranslationKey)}
						</h2>
						<div className="tlui-shortcuts-dialog__group__content">
							{item.children
								.filter((item) => item && item.type === 'item' && item.actionItem.kbd)
								.map(getKeyboardShortcutItem)}
						</div>
					</div>
				)
			}
			case 'item': {
				const { id, label, shortcutsLabel, kbd } = item.actionItem

				return (
					<div className="tlui-shortcuts-dialog__key-pair" key={id}>
						<div className="tlui-shortcuts-dialog__key-pair__key">
							{msg((shortcutsLabel ?? label)!)}
						</div>
						<div className="tlui-shortcuts-dialog__key-pair__value">
							<Kbd>{kbd!}</Kbd>
						</div>
					</div>
				)
			}
		}
	}

	return <>{shortcutsItems.map(getKeyboardShortcutItem)}</>
}
