import { MousePointer2 } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Shared parts every help section is built from.
 *
 * The demos are mock-ups made of the app's own tokens and classes rather than screenshots or a mounted
 * editor. A screenshot bakes in one theme and goes stale the moment the UI moves; a real tldraw editor
 * is most of the bundle and would need demo-data plumbing that doesn't exist. Mock-ups follow the theme
 * for free and weigh nothing.
 *
 * Where a demo shows a *value* — a formatted price, the summaries a type supports — it computes it with
 * the real functions from `@lifeboard/node-kit` instead of writing the answer out. That is the one thing
 * a mock-up can still get wrong on its own, and the one that would be least obvious when it did.
 */

/** Every section component gets a way to send the reader to another section. */
export interface SectionProps {
	go: (section: string) => void
}

/**
 * Drives a demo through numbered steps: hold `durations[step]` ms, advance, wrap around.
 *
 * Runs only while the demo is actually on screen — a dozen timers ticking under the fold would be pure
 * waste — and not at all under `prefers-reduced-motion`, where the demo sits on its final step so the
 * outcome is still shown, just without the ride there.
 */
export function useDemo(durations: readonly number[]) {
	const [step, setStep] = useState(0)
	const [visible, setVisible] = useState(false)
	const reduced = useReducedMotion()
	const ref = useRef<HTMLDivElement | null>(null)

	useEffect(() => {
		const el = ref.current
		if (!el) return
		const io = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? false))
		io.observe(el)
		return () => io.disconnect()
	}, [])

	useEffect(() => {
		if (reduced || !visible) return
		const timer = setTimeout(
			() => setStep((s) => (s + 1) % durations.length),
			durations[step] ?? 1000
		)
		return () => clearTimeout(timer)
	}, [reduced, visible, step, durations])

	return { step: reduced ? durations.length - 1 : step, ref }
}

export function useReducedMotion(): boolean {
	const [reduced, setReduced] = useState(
		() => window.matchMedia('(prefers-reduced-motion: reduce)').matches
	)
	useEffect(() => {
		const query = window.matchMedia('(prefers-reduced-motion: reduce)')
		const onChange = () => setReduced(query.matches)
		query.addEventListener('change', onChange)
		return () => query.removeEventListener('change', onChange)
	}, [])
	return reduced
}

/** The mock pointer every animated demo moves around. */
export function Cursor({ x, y, shown = true }: { x: number; y: number; shown?: boolean }) {
	return (
		<span
			className="lb-demo__cursor"
			style={{ left: x, top: y, opacity: shown ? 1 : 0 }}
			aria-hidden="true"
		>
			<MousePointer2 size={16} fill="currentColor" />
		</span>
	)
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="lb-help__section">
			<h2>{title}</h2>
			{children}
		</section>
	)
}

export function Keys({ keys }: { keys: string[] }) {
	return (
		<span className="lb-help__keys">
			{keys.map((k, i) => (
				<span key={k}>
					{i > 0 && <span className="lb-help__keysep"> · </span>}
					<kbd className="lb-kbd">{k}</kbd>
				</span>
			))}
		</span>
	)
}

/** A link to another help section, for the cross-references the sections make of each other. */
export function Jump({
	to,
	go,
	children,
}: {
	to: string
	go: (section: string) => void
	children: ReactNode
}) {
	return (
		<button className="lb-help__jump" onClick={() => go(to)}>
			{children}
		</button>
	)
}

/**
 * A row of buttons that switches which panel below is shown — the tab bar the interactive demos share.
 *
 * `role="tablist"` and friends are spelled out rather than left to the browser: these are `<button>`s
 * in a `<div>`, and without the roles a screen reader announces a bare list of buttons and no relation
 * to the thing they change.
 */
export function Tabs<T extends string>({
	label,
	value,
	options,
	onChange,
}: {
	label: string
	value: T
	options: readonly { id: T; label: string; hint?: string }[]
	onChange: (id: T) => void
}) {
	return (
		<div className="lb-help__tabs" role="tablist" aria-label={label}>
			{options.map((option) => (
				<button
					key={option.id}
					role="tab"
					aria-selected={option.id === value}
					className={
						option.id === value ? 'lb-help__tab lb-help__tab--on' : 'lb-help__tab'
					}
					onClick={() => onChange(option.id)}
				>
					{option.label}
					{option.hint && <span className="lb-help__tabhint">{option.hint}</span>}
				</button>
			))}
		</div>
	)
}

/** The caption under a demo: what just happened, and why it matters. */
export function Hint({ children }: { children: ReactNode }) {
	return <div className="lb-demo__hint">{children}</div>
}
