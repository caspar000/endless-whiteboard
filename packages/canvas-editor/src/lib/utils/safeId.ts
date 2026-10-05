import { useId } from 'react'

/** An id safe to use in SVG and CSS references (`url(#…)`). @public */
export type SafeId = string & { __brand: 'SafeId' }

/**
 * A unique id for this component, safe for SVG and CSS references. React's ids contain colons, which
 * `url(#…)` doesn't accept.
 *
 * @public
 */
export function useUniqueSafeId(suffix?: string): SafeId {
	const id = useId().replace(/:/g, '_')
	return (suffix ? `${id}_${suffix}` : id) as SafeId
}

/** A further safe id made from one, for when a component needs several. @public */
export function suffixSafeId(id: SafeId, suffix: string): SafeId {
	return `${id}_${suffix.replace(/[^a-zA-Z0-9_-]/g, '_')}` as SafeId
}
