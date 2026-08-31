import {
	RELATION_VIEWS,
	RELATION_VIEW_LABELS,
	RELATION_VIEW_NOTES,
	cycleRelationView,
	isHiddenRelation,
	isRelation,
	registerCommand,
	setRelationHidden,
	setRelationView,
	type CommandContext,
} from '@lifeboard/node-kit'
import { openProperties } from '../canvas/propertiesTarget'
import { runTldrawAction } from '../canvas/tldrawUi'
import { toggleTracing } from '../canvas/tracing'
import {
	APPEARANCE_GROUP,
	BOARDS_GROUP,
	CANVAS_GROUP,
	COMMAND_PREFIX,
	NAVIGATE_GROUP,
} from './paletteItems'
import { EXTENSIONS_TAB } from './settings/sections'
import type { Theme } from './useTheme'

/**
 * The app-shell commands: the composition root for everything a user can do that isn't owned by
 * the canvas or an extension. Registered at module scope — the `extensions.ts` pattern — because
 * commands are static facts about the app, not per-render state, and because an effect-based
 * registration would double-fire under StrictMode.
 *
 * The capability they run against is fed through a module-level holder rather than the
 * `CommandContext`: App.tsx re-points `setAppCommandApi` at its current callbacks every render, so
 * these closures always see live ones. This is what keeps `CommandContext` minimal — app commands
 * get app capability because they live in the app, not because the SDK hands it to every command.
 */
export interface AppCommandApi {
	createAndOpen(): Promise<void>
	goHome(): Promise<void>
	/** `tab` is a settings tab id (`sections.tsx`); omitted means the first one. */
	goSettings(tab?: string): Promise<void>
	goHelp(): Promise<void>
	setTheme(theme: Theme): void
	toggleAgentPanel(): void
	/**
	 * Opens the palette with `seed` already in its input, or closes it if it is already open on that
	 * same seed — which is what makes both palette keys plain toggles while still letting ⌘⇧K
	 * *switch* an already-open palette into command mode instead of shutting it.
	 */
	togglePalette(seed?: string): void
}

let api: AppCommandApi | null = null

/** Called by App on every render. Cheap, idempotent, StrictMode-safe. */
export function setAppCommandApi(next: AppCommandApi): void {
	api = next
}

registerCommand({
	id: 'board.new',
	title: 'New board',
	group: BOARDS_GROUP,
	run: () => void api?.createAndOpen(),
})

registerCommand({
	id: 'view.home',
	title: 'All boards',
	group: NAVIGATE_GROUP,
	run: () => void api?.goHome(),
})

/**
 * ⌘K itself, as an ordinary row.
 *
 * It was a bespoke `window` listener in App.tsx until the keymap existed. Now that one dispatcher
 * reads the table, the palette's own key has no reason to be special — and putting it in means it
 * shows up on the Help page and can be rebound like anything else.
 */
registerCommand({
	id: 'view.palette',
	title: 'Command palette',
	group: NAVIGATE_GROUP,
	kbd: 'cmd+k',
	run: () => api?.togglePalette(),
})

/**
 * The same palette, opened straight into command mode — `>` already typed.
 *
 * Its own command rather than an argument to the one above, because the keymap binds commands and
 * this is the door people want bound: ⌘K is "where is that board", ⌘⇧K is "what can I do". The seed
 * is the real prefix constant, so the two cannot drift if the character ever changes.
 */
registerCommand({
	id: 'view.palette.commands',
	title: 'Command palette — commands',
	group: NAVIGATE_GROUP,
	kbd: 'cmd+shift+k',
	run: () => api?.togglePalette(`${COMMAND_PREFIX} `),
})

registerCommand({
	id: 'view.agent',
	title: 'Toggle agent panel',
	group: NAVIGATE_GROUP,
	kbd: 'cmd+shift+a',
	run: () => api?.toggleAgentPanel(),
})

registerCommand({
	id: 'view.settings',
	title: 'Open settings',
	group: NAVIGATE_GROUP,
	run: () => void api?.goSettings(),
})

registerCommand({
	id: 'view.extensions',
	title: 'Manage extensions',
	group: NAVIGATE_GROUP,
	run: () => void api?.goSettings(EXTENSIONS_TAB),
})

registerCommand({
	id: 'view.help',
	title: 'Open help',
	group: NAVIGATE_GROUP,
	run: () => void api?.goHelp(),
})

const THEME_TITLES: Record<Theme, string> = {
	light: 'Theme: Light',
	dark: 'Theme: Dark',
	system: 'Theme: System',
}

for (const theme of ['light', 'dark', 'system'] as const) {
	registerCommand({
		id: `view.theme.${theme}`,
		title: THEME_TITLES[theme],
		group: APPEARANCE_GROUP,
		run: () => api?.setTheme(theme),
	})
}

// ---------------------------------------------------------------------------
// Canvas commands, gated on there being an editor. Undo/redo and zoom deliberately have no other UI
// — removing tldraw's menu panel took theirs away — so the command table is their home.
//
// The ones tldraw also implements **delegate to its action** rather than reimplementing it (see
// `canvas/tldrawUi.ts`). Their `kbd`s are still tldraw's own bindings, but they are no longer merely
// recorded: the app now dispatches them (`app/useKeymap.ts`) so the user can move them, and it runs
// the same action tldraw would have. One implementation, three doors — the palette, the key, and
// tldraw's own menus.
// ---------------------------------------------------------------------------

const onBoard = (ctx: CommandContext) => ctx.editor !== null

/**
 * Emacs' `interactive` predicate, doing real work: "Duplicate" with an empty selection is not a
 * command that fails, it is a command that isn't offered. The palette applies this; the Help page
 * deliberately does not, because a reference documents what exists rather than what is available
 * this second.
 */
const hasSelection = (ctx: CommandContext) =>
	ctx.editor !== null && ctx.editor.getSelectedShapeIds().length > 0

/** The one selected shape, or `null` — what the relation commands are about. */
const onlySelected = (ctx: CommandContext) => ctx.editor?.getOnlySelectedShape() ?? null

const hasRelationSelected = (ctx: CommandContext) =>
	ctx.editor !== null && isRelation(ctx.editor, onlySelected(ctx) ?? undefined)

registerCommand({
	id: 'edit.undo',
	title: 'Undo',
	group: CANVAS_GROUP,
	kbd: 'cmd+z',
	when: onBoard,
	run: (ctx) => {
		if (ctx.editor) runTldrawAction(ctx.editor, 'undo')
	},
})

registerCommand({
	id: 'edit.redo',
	title: 'Redo',
	group: CANVAS_GROUP,
	kbd: 'cmd+shift+z',
	when: onBoard,
	run: (ctx) => {
		if (ctx.editor) runTldrawAction(ctx.editor, 'redo')
	},
})

registerCommand({
	id: 'view.zoom-fit',
	title: 'Zoom to fit',
	group: CANVAS_GROUP,
	kbd: 'shift+1',
	when: onBoard,
	run: (ctx) => {
		if (ctx.editor) runTldrawAction(ctx.editor, 'zoom-to-fit')
	},
})

registerCommand({
	id: 'view.zoom-reset',
	title: 'Zoom to 100%',
	group: CANVAS_GROUP,
	kbd: 'shift+0',
	when: onBoard,
	run: (ctx) => {
		if (ctx.editor) runTldrawAction(ctx.editor, 'zoom-to-100')
	},
})

registerCommand({
	id: 'shape.properties',
	title: 'Properties of the selected shape',
	group: CANVAS_GROUP,
	kbd: 'alt+p',
	when: hasSelection,
	run: (ctx) => {
		const id = ctx.editor?.getSelectedShapeIds()[0]
		if (id) openProperties(id)
	},
})

/**
 * The keyboard half of the selection toolbar's eye button.
 *
 * One command rather than a "hide" and a "show", because it acts on one relation whose state you can
 * see — the palette's title reads as the thing that will happen. Offered only when a relation is
 * selected: `when` decides whether a command is *available*, and "hide relation" with a sticky
 * selected is not a command that fails, it is one that isn't there.
 */
registerCommand({
	id: 'relation.toggle-hidden',
	title: 'Hide or show the selected relation',
	group: CANVAS_GROUP,
	when: hasRelationSelected,
	run: (ctx) => {
		const editor = ctx.editor
		const shape = onlySelected(ctx)
		if (!editor || !shape) return
		setRelationHidden(editor, shape.id, !isHiddenRelation(shape), { markHistory: true })
	},
})

/**
 * The board's relation view, as four commands: one per state, plus the cycle the dock button runs.
 *
 * Both, deliberately. The cycle is the fast gesture and gets the keybinding; the three named states
 * are what you use when you know where you want to end up, and they are also what makes the feature
 * *findable* — someone who has lost a relation searches "relations", not "cycle".
 */
for (const view of RELATION_VIEWS) {
	registerCommand({
		id: `view.relations.${view}`,
		title: `Relations: ${RELATION_VIEW_LABELS[view].toLowerCase()} — ${RELATION_VIEW_NOTES[view]}`,
		group: CANVAS_GROUP,
		when: onBoard,
		run: (ctx) => {
			if (ctx.editor) setRelationView(ctx.editor, view)
		},
	})
}

registerCommand({
	id: 'view.relations.cycle',
	title: 'Cycle the relation view',
	group: CANVAS_GROUP,
	// Display only — the key is dispatched by the tldraw action of the same name in
	// canvas/uiOverrides.tsx, which is the only layer that hears keystrokes on the canvas.
	// `alt+shift+r` because plain `alt+r` is tldraw's own (rotate), as uiOverrides.tsx records.
	kbd: 'alt+shift+r',
	when: onBoard,
	run: (ctx) => {
		if (ctx.editor) cycleRelationView(ctx.editor)
	},
})

registerCommand({
	id: 'view.tracing',
	title: 'Trace relations — light up what a shape is connected to',
	group: CANVAS_GROUP,
	// Display only; the key is dispatched by the tldraw action in canvas/uiOverrides.tsx.
	kbd: 'alt+shift+t',
	when: onBoard,
	run: () => {
		toggleTracing()
	},
})

/**
 * Duplicate and Delete, delegated for a reason worth spelling out: tldraw's ⌘D places the copy
 * beside the original (or an adjacent-margin away when the camera is locked) and keeps stepping if
 * you hold it, and its ⌫ marks a history stopping point first. Both of those were missing here, so
 * the palette's rows have never quite done what the keys do. Now they are the same action.
 */
registerCommand({
	id: 'edit.duplicate',
	title: 'Duplicate',
	group: CANVAS_GROUP,
	kbd: 'cmd+d',
	when: hasSelection,
	run: (ctx) => {
		if (ctx.editor) runTldrawAction(ctx.editor, 'duplicate')
	},
})

registerCommand({
	id: 'edit.delete',
	title: 'Delete',
	group: CANVAS_GROUP,
	// `⌫` is how tldraw spells it; `backspace` is the same chord after normalisation (`keymap.ts`).
	kbd: 'backspace,delete',
	when: hasSelection,
	run: (ctx) => {
		if (ctx.editor) runTldrawAction(ctx.editor, 'delete')
	},
})
