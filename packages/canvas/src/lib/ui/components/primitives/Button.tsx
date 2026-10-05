import type { ReactElement } from 'react'
import classnames from 'classnames'
import * as React from 'react'
import { TLUiTranslationKey } from '../../hooks/useTranslation/TLUiTranslationKey'
import { useTranslation } from '../../hooks/useTranslation/useTranslation'
import { TLUiIconType } from '../../icon-types'
import { Spinner } from '../Spinner'
import { Icon } from './Icon'
import { Kbd } from './Kbd'

/** @public */
export interface TLUiButtonProps extends React.HTMLAttributes<HTMLButtonElement> {
	loading?: boolean // TODO: loading spinner
	disabled?: boolean
	label?: TLUiTranslationKey | Exclude<string, TLUiTranslationKey>
	/** An icon name, or any element (an app's own glyph). */
	icon?: TLUiIconType | Exclude<string, TLUiIconType> | ReactElement
	spinner?: boolean
	iconLeft?: TLUiIconType | Exclude<string, TLUiIconType> | ReactElement
	smallIcon?: boolean
	kbd?: string
	isChecked?: boolean
	invertIcon?: boolean
	type: 'normal' | 'primary' | 'danger' | 'low' | 'icon' | 'tool' | 'menu' | 'help'
}

/** @public */
export const Button = React.forwardRef<HTMLButtonElement, TLUiButtonProps>(function Button(
	{
		label,
		icon,
		invertIcon,
		iconLeft,
		smallIcon,
		kbd,
		isChecked = false,
		type,
		children,
		spinner,
		...props
	},
	ref
) {
	const msg = useTranslation()
	const labelStr = label ? msg(label) : ''

	return (
		<button
			ref={ref}
			draggable={false}
			type="button"
			{...props}
			title={props.title ?? labelStr}
			className={classnames('tlui-button', `tlui-button__${type}`, props.className)}
		>
			{iconLeft && typeof iconLeft !== 'string' && iconLeft}
			{iconLeft && typeof iconLeft === 'string' && (
				<Icon icon={iconLeft} className="tlui-button__icon-left" small />
			)}
			{children}
			{label && (
				<span className="tlui-button__label" draggable={false}>
					{labelStr}
					{isChecked && <Icon icon="check" />}
				</span>
			)}
			{kbd && <Kbd>{kbd}</Kbd>}
			{icon && !spinner && typeof icon !== 'string' && icon}
			{icon && !spinner && typeof icon === 'string' && (
				<Icon icon={icon} small={!!label || smallIcon} invertIcon={invertIcon} />
			)}
			{spinner && <Spinner />}
		</button>
	)
})
