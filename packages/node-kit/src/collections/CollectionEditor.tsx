import type { Editor, TLShape } from 'tldraw'
import { summaryLabel, summaryOpsForType } from '../nodes/table/spec'
import type { PropertyDef } from '../properties/types'
import { defaultCollection, setCollection, type Collection } from './spec'

/**
 * The "gathers" half of the properties panel.
 *
 * Four controls in the common case — on, from where, show what, of which property — and no column
 * editor unless one is asked for. That ratio is the point: the thing people want most often is one
 * number beside a label, and making them configure a table to get it is what made a table feel like
 * a separate kind of object instead of one way of looking at a set.
 *
 * Separated from the values above it by a rule, because "this costs ₾2,000" and "show me everything
 * pointing at me" are different kinds of statement about a shape and reading them as one list is
 * exactly the confusion this is meant to end.
 */
export function CollectionEditor({
	editor,
	shape,
	collection,
	registry,
}: {
	editor: Editor
	shape: TLShape
	collection: Collection | null
	registry: readonly PropertyDef[]
}) {
	const update = (patch: Partial<Collection>) => {
		if (!collection) return
		setCollection(editor, shape, { ...collection, ...patch })
	}

	const def = collection?.property ? registry.find((d) => d.id === collection.property) : undefined
	// A property that is not a number can still be counted, so the op list narrows rather than empties.
	const ops = summaryOpsForType(def?.type ?? null)

	/*
	 * Changing the property can strip the current summary of its meaning — you cannot total a date.
	 * Falling back to a count keeps the panel showing something true rather than a stale op the new
	 * list no longer contains, which a <select> renders as a blank row.
	 */
	const changeProperty = (id: string | null) => {
		if (!collection) return
		const next = registry.find((d) => d.id === id)
		const allowed = summaryOpsForType(next?.type ?? null)
		setCollection(editor, shape, {
			...collection,
			property: id,
			op: allowed.includes(collection.op) ? collection.op : 'count',
		})
	}

	return (
		<div className="lb-collect-edit">
			<label className="lb-collect-edit__head">
				<span>Collects</span>
				<input
					type="checkbox"
					aria-label="Collects"
					checked={collection !== null}
					onChange={(e) =>
						setCollection(
							editor,
							shape,
							e.currentTarget.checked
								? // A shape inside a frame starts by collecting that frame — see `defaultCollection`.
									defaultCollection(editor.getShape(shape.parentId)?.type === 'frame')
								: null
						)
					}
				/>
			</label>

			{collection && (
				<div className="lb-collect-edit__body">
					<label className="lb-collect-edit__row">
						<span>From</span>
						<select
							aria-label="Collect from"
							value={sourceKey(collection)}
							onChange={(e) => update({ source: sourceFor(collection, e.currentTarget.value) })}
						>
							<option value="in">arrows pointing in</option>
							<option value="out">arrows pointing out</option>
							<option value="either">arrows either way (in − out)</option>
							<option value="frame">shapes in this frame</option>
							<option value="page">everything on this board</option>
						</select>
					</label>

					{/*
					 * Property before summary, so the three rows read as one sentence: *from* arrows in,
					 * *of* Price, *show* the total. It also has to be this way round — which summaries
					 * exist depends on the property's type, so a panel that asked for the summary first
					 * could only ever offer the ones that need no property, and "the total" was
					 * unreachable however many times you clicked.
					 */}
					<label className="lb-collect-edit__row">
						<span>Of</span>
						<select
							aria-label="Collect property"
							value={collection.property ?? ''}
							onChange={(e) => changeProperty(e.currentTarget.value || null)}
						>
							{/* Counting rows needs no property, and offering one implies it would change
							    the answer. */}
							<option value="">— nothing, just the rows —</option>
							{registry.map((entry) => (
								<option key={entry.id} value={entry.id}>
									{entry.name}
								</option>
							))}
						</select>
					</label>

					<label className="lb-collect-edit__row">
						<span>Show</span>
						<select
							aria-label="Collect show"
							value={collection.view === 'list' ? 'list' : collection.op}
							onChange={(e) => {
								const next = e.currentTarget.value
								if (next === 'list') update({ view: 'list' })
								// Leaving the list goes back to a number, and `op` carries which one.
								else update({ view: 'value', op: next as Collection['op'] })
							}}
						>
							<option value="list">the list</option>
							{ops.map((op) => (
								<option key={op} value={op}>
									{summaryLabel(op)}
								</option>
							))}
						</select>
					</label>
				</div>
			)}
		</div>
	)
}

/**
 * The five sources collapse two fields — `scope` and `direction` — into one menu, because "arrows in"
 * and "arrows out" are two answers to one question as far as anyone choosing is concerned.
 */
function sourceKey(collection: Collection): string {
	if (collection.source.scope !== 'connected') return collection.source.scope
	return collection.source.direction ?? 'either'
}

function sourceFor(collection: Collection, key: string): Collection['source'] {
	if (key === 'page' || key === 'frame') return { ...collection.source, scope: key }
	return {
		...collection.source,
		scope: 'connected',
		direction: key as 'in' | 'out' | 'either',
		/*
		 * Both ways at once means a balance, not a pile.
		 *
		 * If you have wired two shapes into a collector and one out of it, you have drawn a flow, and
		 * the only reading of the arrows that respects what you drew is that what points in adds and
		 * what points away subtracts. Adding all three together would give a number matching nothing on
		 * the board. One direction on its own needs no sign — every row is on the same side of it.
		 */
		signed: key === 'either',
	}
}
