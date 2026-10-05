import { Box2d, stopEventPropagation, useValue } from '@lifeboard/canvas-editor'
import classNames from 'classnames'
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

/**
 * A toolbar floating above the selection. `getSelectionBounds` says where, in the editor container's
 * space (`editor.getSelectionScreenBounds()` is the usual answer); it is read reactively, so the bar
 * follows the camera and the shapes. Nothing is drawn while it returns nothing.
 *
 * @public
 */
export function TldrawUiContextualToolbar({
	getSelectionBounds,
	label,
	className,
	children,
}: {
	getSelectionBounds(): Box2d | undefined
	label: string
	className?: string
	children?: ReactNode
}) {
	const bounds = useValue('contextual toolbar bounds', () => getSelectionBounds(), [getSelectionBounds])
	if (!bounds) return null
	return (
		<div
			role="toolbar"
			aria-label={label}
			className={classNames('tlui-contextual-toolbar', className)}
			style={{ left: bounds.midX, top: bounds.minY }}
			onPointerDown={stopEventPropagation}
		>
			{children}
		</div>
	)
}

/**
 * A button for a toolbar. `tooltip` is shown on hover; `type: 'icon'` is a square button for an icon.
 *
 * @public
 */
export const TldrawUiToolbarButton = forwardRef<
	HTMLButtonElement,
	Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & {
		type: 'icon' | 'normal' | 'menu'
		tooltip?: string
		/** Shown pressed: a toggle that is on, or the button whose panel is open. */
		isActive?: boolean
	}
>(function TldrawUiToolbarButton({ type, tooltip, title, isActive, className, children, ...props }, ref) {
	return (
		<button
			ref={ref}
			type="button"
			data-active={isActive}
			aria-pressed={isActive}
			className={classNames('tlui-button', `tlui-button__${type}`, className)}
			title={title ?? tooltip}
			aria-label={title ?? tooltip}
			{...props}
		>
			{children}
		</button>
	)
})
