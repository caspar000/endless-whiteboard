import {
	chordsFor,
	getVisibleNodeDefinitions,
	subscribeToKeymap,
	subscribeToNodeDefinitions,
	type NodeDefinition,
} from '@lifeboard/node-kit'
import { Boxes } from 'lucide-react'
import {
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
	useSyncExternalStore,
} from 'react'
import { useEditor, useValue } from 'tldraw'
import { formatKbd, isMacPlatform } from '../app/paletteItems'
import { isNodeMenuOpen, setNodeMenuOpen, toggleNodeMenu } from './nodeMenuState'
import { toolIdForNodeType } from './nodeTools'
import { runTldrawTool } from './tldrawUi'

/**
 * The dock's node picker: one button that opens a searchable grid of every node type.
 *
 * The node types used to sit in the dock as buttons, one each, in registry order. That worked while
 * there were two of them and stopped working at five: the dock grew every time an extension was
 * installed, and a row of glyphs is the wrong shape for a list that a third party can extend
 * arbitrarily. A picker is the right shape — it has a search box, it can hold a hundred entries, and
 * the dock's width stops being a budget that node types compete for.
 *
 * Still registry-driven, which is the part that must not change (§7): the grid is
 * `getVisibleNodeDefinitions()` and nothing here names a type. An extension's node appears in the
 * grid, searchable by its own label, without a line being written here.
 *
 * Picking a tile **selects that node's tool** rather than placing a node, which is exactly what the
 * old dock button did — you then click or drag on the canvas. "Add <node>" in ⌘K is the other door,
 * and it places one at the viewport centre; the two are deliberately different verbs.
 */

const ICON_SIZE = 19
const TILE_ICON_SIZE = 22

/** The command that opens this menu, registered in `toolCommands.ts` alongside the tools. */
const NODE_MENU_COMMAND = 'tool.nodes'

/** Case-insensitive substring, the same rule the palette's rows are filtered by. */
function matches(needle: string, ...haystacks: string[]): boolean {
	if (!needle) return true
	const lower = needle.toLowerCase()
	return haystacks.some((hay) => hay.toLowerCase().includes(lower))
}

/**
 * The key this node's tool actually answers to, asked of the keymap rather than read off the
 * definition — the user may have moved it, and `def.kbd` is only the default.
 */
function toolChord(nodeType: string, mac: boolean): string | null {
	const chord = chordsFor(`tool.${nodeType}`)[0]
	return chord ? formatKbd(chord, mac) : null
}

/** The last segment of `node.markdown` / `plugin.acme.gantt` — a second thing worth searching by. */
function typeNeedle(type: string): string {
	return type.slice(type.lastIndexOf('.') + 1)
}

/** A re-render whenever any binding changes. */
function useKeymapVersion(): void {
	const [, bump] = useReducer((n: number) => n + 1, 0)
	useEffect(() => subscribeToKeymap(bump), [bump])
}

function NodeTile({
	def,
	mac,
	active,
	onPick,
	tileRef,
}: {
	def: NodeDefinition<never>
	mac: boolean
	active: boolean
	onPick: () => void
	tileRef?: React.Ref<HTMLButtonElement>
}) {
	const Icon = def.toolbarIcon
	const chord = toolChord(def.type, mac)
	return (
		<button
			ref={tileRef}
			// The dock's old testid scheme, kept: the tools moved, but the thing a test asks for — "the
			// button that picks the markdown node" — did not, and the e2e suite already targets these.
			data-testid={`tools.${toolIdForNodeType(def.type)}`}
			className={active ? 'lb-nodemenu__tile lb-nodemenu__tile--on' : 'lb-nodemenu__tile'}
			type="button"
			// The pointer must not leave the search box: the caret belongs there for the whole
			// interaction, exactly as it does in the ⌘K palette.
			onPointerDown={(e) => e.preventDefault()}
			onClick={onPick}
			title={def.label}
		>
			<span className="lb-nodemenu__tileicon" aria-hidden="true">
				{Icon ? <Icon size={TILE_ICON_SIZE} /> : <span className="lb-tool-icon">{def.icon}</span>}
			</span>
			<span className="lb-nodemenu__tilelabel">{def.label}</span>
			{/* The slot is always there, hidden when the node has no key, so a row of tiles is one
			    height whether or not the types in it happen to have shortcuts. */}
			<kbd
				className={chord ? 'lb-nodemenu__tilekbd' : 'lb-nodemenu__tilekbd lb-nodemenu__tilekbd--none'}
				aria-hidden={chord ? undefined : 'true'}
			>
				{chord ?? '·'}
			</kbd>
		</button>
	)
}

/**
 * The panel. Rendered only while open, so there is no hidden search box for the page's focus order
 * to walk through and no autofocus racing between boards.
 *
 * A combobox on the same terms as the palette: the input keeps DOM focus and a *virtual* highlight
 * moves through the grid. Moving real focus onto a tile would take the caret out of the search box,
 * and every keystroke after that would have to be routed back by hand.
 */
function NodeMenuPanel({ onClose }: { onClose: () => void }) {
	const editor = useEditor()
	const [needle, setNeedle] = useState('')
	const [selected, setSelected] = useState(0)
	const inputRef = useRef<HTMLInputElement>(null)
	const gridRef = useRef<HTMLDivElement>(null)
	const activeRef = useRef<HTMLButtonElement>(null)

	// The registry's own store, not tldraw's `useValue`: it deliberately owns its reactivity (see
	// node-kit's registry.tsx), and this is the same seam the dock reads.
	const defs = useSyncExternalStore(subscribeToNodeDefinitions, getVisibleNodeDefinitions)
	// Re-read the chords when the user rebinds one, or when an extension's commands come and go — the
	// keymap store invalidates on both. Not `useSyncExternalStore`: `chordsFor` returns a fresh array
	// per call, so it has no snapshot React could compare.
	useKeymapVersion()
	const mac = useMemo(() => isMacPlatform(), [])

	const shown = useMemo(
		() => defs.filter((def) => matches(needle, def.label, typeNeedle(def.type))),
		[defs, needle]
	)
	const active = shown.length === 0 ? 0 : Math.min(selected, shown.length - 1)

	useEffect(() => {
		inputRef.current?.focus()
	}, [])

	/*
	 * Scrolled by hand rather than with `scrollIntoView`, for the reason the palette records: that
	 * call walks up the tree and scrolls every scrollable ancestor it finds — here, the board behind
	 * the panel. Only this grid may move.
	 */
	useEffect(() => {
		const tile = activeRef.current
		const grid = gridRef.current
		if (!tile || !grid) return
		const top = tile.offsetTop
		const bottom = top + tile.offsetHeight
		if (top < grid.scrollTop) grid.scrollTop = top
		else if (bottom > grid.scrollTop + grid.clientHeight) {
			grid.scrollTop = bottom - grid.clientHeight
		}
	}, [active, shown.length])

	const pick = (def: NodeDefinition<never>) => {
		// Through tldraw's own tool entry rather than `setCurrentTool`, the same way the tool commands
		// do — its `onSelect` is what leaves an open edit before switching.
		runTldrawTool(editor, toolIdForNodeType(def.type))
		onClose()
	}

	/**
	 * How many tiles are on a row, measured rather than assumed: the grid is `auto-fill`, so the count
	 * follows the panel's width and a hardcoded number would send Down one row on some widths and two
	 * on others.
	 */
	const columns = (): number => {
		const grid = gridRef.current
		if (!grid) return 1
		const tiles = [...grid.children] as HTMLElement[]
		if (tiles.length === 0) return 1
		const firstTop = tiles[0]!.offsetTop
		const count = tiles.filter((tile) => tile.offsetTop === firstTop).length
		return Math.max(1, count)
	}

	const onKeyDown = (event: React.KeyboardEvent) => {
		// Never past this component: the board underneath must not act on the picker's keystrokes, and
		// the app's own dispatcher runs in the capture phase, so this only has to stop tldraw.
		const move = (delta: number) => {
			event.preventDefault()
			if (shown.length === 0) return
			setSelected((current) => {
				const from = Math.min(current, shown.length - 1)
				return Math.max(0, Math.min(shown.length - 1, from + delta))
			})
		}
		switch (event.key) {
			case 'Escape':
				event.preventDefault()
				event.stopPropagation()
				onClose()
				return
			case 'ArrowRight':
				// Only when the caret is at the end, so arrows still move through what you typed.
				if (event.currentTarget instanceof HTMLInputElement) {
					const input = event.currentTarget
					if (input.selectionStart !== input.value.length) return
				}
				move(1)
				return
			case 'ArrowLeft':
				if (event.currentTarget instanceof HTMLInputElement) {
					const input = event.currentTarget
					if (input.selectionStart !== 0) return
				}
				move(-1)
				return
			case 'ArrowDown':
				move(columns())
				return
			case 'ArrowUp':
				move(-columns())
				return
			case 'Enter': {
				event.preventDefault()
				const def = shown[active]
				if (def) pick(def)
				return
			}
			default:
				return
		}
	}

	return (
		<div className="lb-nodemenu__panel" role="dialog" aria-label="Node types">
			<input
				ref={inputRef}
				className="lb-nodemenu__search"
				type="text"
				value={needle}
				placeholder="Search node types"
				aria-label="Search node types"
				role="combobox"
				aria-expanded="true"
				aria-controls="lb-nodemenu-grid"
				autoComplete="off"
				spellCheck={false}
				onChange={(event) => {
					setNeedle(event.target.value)
					setSelected(0)
				}}
				onKeyDown={onKeyDown}
			/>
			{shown.length === 0 ? (
				<p className="lb-nodemenu__empty">
					{defs.length === 0
						? 'No node types are enabled. Settings → Extensions turns them back on.'
						: `Nothing matches “${needle}”.`}
				</p>
			) : (
				<div
					ref={gridRef}
					id="lb-nodemenu-grid"
					className="lb-nodemenu__grid"
					role="listbox"
					aria-label="Node types"
				>
					{shown.map((def, index) => (
						<NodeTile
							key={def.type}
							def={def}
							mac={mac}
							active={index === active}
							tileRef={index === active ? activeRef : undefined}
							onPick={() => pick(def)}
						/>
					))}
				</div>
			)}
		</div>
	)
}

/** The dock button, and the panel it anchors. */
export function NodeMenuButton() {
	const editor = useEditor()
	const open = useValue('lb:node-menu', () => isNodeMenuOpen(editor), [editor])
	const mac = useMemo(() => isMacPlatform(), [])
	useKeymapVersion()
	const chord = chordsFor(NODE_MENU_COMMAND)[0]
	const kbd = chord ? formatKbd(chord, mac) : null

	// A click anywhere else closes it — a popover that only closes by its own button is one you end up
	// dismissing by guessing. Scoped to `pointerdown` on the container so the canvas keeps the event.
	useEffect(() => {
		if (!open) return
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target
			if (target instanceof Element && target.closest('.lb-nodemenu')) return
			setNodeMenuOpen(editor, false)
		}
		window.addEventListener('pointerdown', onPointerDown, { capture: true })
		return () => window.removeEventListener('pointerdown', onPointerDown, { capture: true })
	}, [open, editor])

	return (
		<div className="lb-nodemenu">
			{open && <NodeMenuPanel onClose={() => setNodeMenuOpen(editor, false)} />}
			<button
				className={open ? 'lb-dock__tool lb-dock__tool--active' : 'lb-dock__tool'}
				data-testid="lb.node-menu"
				type="button"
				onPointerDown={(e) => e.preventDefault()}
				onClick={() => toggleNodeMenu(editor)}
				title={kbd ? `Node types (${kbd})` : 'Node types'}
				aria-label="Node types"
				aria-expanded={open}
				aria-haspopup="dialog"
			>
				<Boxes size={ICON_SIZE} aria-hidden="true" />
			</button>
		</div>
	)
}
