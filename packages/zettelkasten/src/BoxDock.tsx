import { useEditor, useValue, type Editor } from '@lifeboard/canvas'
import { GitBranchPlus, Layers, LayoutGrid, Plus, SquarePlus } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { boxOrder, hasWriting, layoutBox, shapeByZid } from './box'
import { isBoxId } from './ids'
import { StackView, writeNote } from './stack/StackView'
import { registerJumpField } from './stack/jump'
import { boxNotice, getStack, setStackOpen, showCard } from './stack/state'

const ICON = 20

/** How long a notice stays up. */
const NOTICE_MS = 6000

function DockButton({
	label,
	keys,
	active = false,
	onClick,
	children,
}: {
	label: string
	keys?: string
	active?: boolean
	onClick: () => void
	children: ReactNode
}) {
	return (
		<button
			type="button"
			className={active ? 'lb-dock__tool lb-dock__tool--active' : 'lb-dock__tool'}
			title={keys ? `${label} (${keys})` : label}
			aria-label={label}
			aria-pressed={active}
			onClick={onClick}
		>
			{children}
		</button>
	)
}

/** Shows the box laid out on the table (the canvas), framed. */
export function showTable(editor: Editor): void {
	editor.complete()
	setStackOpen(editor, false)
	layoutBox(editor)
	requestAnimationFrame(() => editor.zoomToFit({ animation: { duration: 220 } }))
}

/**
 * A box's bar, in the dock's place (node-kit's `BoardKind.Dock`): which view, the three ways of
 * writing a note, and a field to go to a note by its id. The stack is mounted from here too, so it
 * exists exactly while the board is a box.
 */
export function BoxDock() {
	const editor = useEditor()
	const open = useValue('lifeboard:zettel-stack-open', () => getStack(editor).open, [editor])
	const written = useValue('lifeboard:zettel-written', () => hasWriting(boxOrder(editor)), [editor])
	const notice = useValue('lifeboard:zettel-notice', () => boxNotice.get(), [])
	const [missing, setMissing] = useState<string | null>(null)
	const input = useRef<HTMLInputElement>(null)

	useEffect(() => registerJumpField(input.current), [written])

	useEffect(() => {
		if (!notice) return
		const timer = setTimeout(() => boxNotice.set(null), NOTICE_MS - (Date.now() - notice.at))
		return () => clearTimeout(timer)
	}, [notice])

	const jump = (text: string) => {
		const zid = text.trim().toLowerCase()
		if (!zid) return
		if (isBoxId(zid) && shapeByZid(editor, zid)) {
			setMissing(null)
			showCard(editor, zid)
			input.current!.value = ''
			input.current!.blur()
		} else {
			setMissing(zid)
		}
	}

	return (
		<div className="lb-dock-wrap lb-zdock">
			<StackView />
			{(notice || missing) && (
				<div className="lb-zdock__notice" role="status">
					{missing ? `There is no note ${missing} in this box.` : notice!.text}
				</div>
			)}
			<div className="lb-dock" role="toolbar" aria-label="Box">
				<DockButton label="Stack" active={open} onClick={() => setStackOpen(editor, true)}>
					<Layers size={ICON} aria-hidden="true" />
				</DockButton>
				<DockButton label="Table" active={!open} onClick={() => showTable(editor)}>
					<LayoutGrid size={ICON} aria-hidden="true" />
				</DockButton>

				<div className="lb-dock__sep" />

				{!written ? (
					<DockButton label="Write the first note" keys="N" onClick={() => writeNote(editor, 'train')}>
						<Plus size={ICON} aria-hidden="true" />
					</DockButton>
				) : (
					<>
						<DockButton label="New note behind this one" keys="N" onClick={() => writeNote(editor, 'behind')}>
							<Plus size={ICON} aria-hidden="true" />
						</DockButton>
						<DockButton label="Branch from this note" keys="⇧N" onClick={() => writeNote(editor, 'branch')}>
							<GitBranchPlus size={ICON} aria-hidden="true" />
						</DockButton>
						<DockButton label="New train of thought" onClick={() => writeNote(editor, 'train')}>
							<SquarePlus size={ICON} aria-hidden="true" />
						</DockButton>

						<div className="lb-dock__sep" />

						<form
							className="lb-zdock__jump"
							onSubmit={(event) => {
								event.preventDefault()
								jump(input.current?.value ?? '')
							}}
						>
							<input
								ref={input}
								type="text"
								inputMode="text"
								autoComplete="off"
								spellCheck={false}
								placeholder="Go to…"
								aria-label="Go to a note by its number"
								onChange={() => setMissing(null)}
								onKeyDown={(event) => {
									if (event.key === 'Escape') {
										event.currentTarget.value = ''
										event.currentTarget.blur()
										setMissing(null)
									}
								}}
							/>
						</form>
					</>
				)}
			</div>
		</div>
	)
}
