import { useState, useSyncExternalStore } from 'react'
import {
	findAgentModel,
	getAgentModelSelection,
	setAgentEffort,
	setAgentModel,
	subscribeToAgentModelSelection,
	type EffortLevel,
} from '../agent/models'
import { ClaudeMark } from './AgentBrandIcons'
import { AgentMenu, AgentMenuShell, type AgentMenuOption } from './AgentMenu'
import { AgentModelPicker } from './AgentModelPicker'

/**
 * Model and reasoning level, on the composer's own row.
 *
 * These are the two dials that decide what a turn costs, so they live where the turn is written — the
 * same place T3 Code puts them, and for the same reason: the right level for "add a note per city" is
 * not the right level for "work out which of these is cheapest", and nobody is going to open Settings
 * between the two.
 *
 * The effort control disappears rather than greys out on a model with no reasoning parameter. A
 * disabled dial invites a click and then explains itself; an absent one has already explained itself.
 */
export function AgentModelControls({ disabled }: { disabled?: boolean }) {
	const selection = useSyncExternalStore(subscribeToAgentModelSelection, getAgentModelSelection)
	const model = findAgentModel(selection.model)

	const effortOptions: AgentMenuOption<EffortLevel>[] = (model?.efforts ?? []).map((option) => ({
		value: option.value,
		label: option.label,
		description: option.description,
		// The model's own default, not the panel's — worth marking so somebody comparing against Claude
		// Code's behaviour can see which row that is.
		isDefault: option.value === model?.defaultEffort,
	}))

	return (
		<div className="lb-agent-controls">
			<ModelTrigger
				label={
					<>
						{/* The mark rather than the word: "Claude Sonnet 5" would spend a third of a 360px row
						    saying "Claude", and the icon says it in 14px. */}
						<ClaudeMark size={13} />
						{model?.shortName ?? selection.model}
					</>
				}
				value={selection.model}
				disabled={disabled}
			/>
			{selection.effort && effortOptions.length > 0 && (
				<AgentMenu
					title="Reasoning"
					trigger={effortOptions.find((option) => option.value === selection.effort)?.label ?? selection.effort}
					value={selection.effort}
					options={effortOptions}
					onPick={setAgentEffort}
					disabled={disabled}
				/>
			)}
		</div>
	)
}

/**
 * The model trigger, which opens the picker rather than a menu.
 *
 * Separated from `AgentMenu` because the picker is not a list of options — it has a rail, a search box
 * and its own keyboard handling. What the two share is the trigger and the popover placement, and that
 * is what `AgentMenuShell` is.
 */
function ModelTrigger({
	label,
	value,
	disabled,
}: {
	label: React.ReactNode
	value: string
	disabled?: boolean
}) {
	const [open, setOpen] = useState(false)

	return (
		<AgentMenuShell
			title="Model"
			trigger={label}
			open={open}
			onOpenChange={setOpen}
			disabled={disabled}
			wide
		>
			<AgentModelPicker value={value} onPick={setAgentModel} onClose={() => setOpen(false)} />
		</AgentMenuShell>
	)
}
