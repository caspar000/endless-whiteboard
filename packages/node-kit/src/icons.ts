import type { ComponentType } from 'react'

/**
 * The app's icon catalogue, as an extension sees it: draw an icon by name, and pick one.
 *
 * A seam rather than an import, the same shape as `AssetBridge` and `NetworkBridge`: the catalogue
 * (Tabler's outline set, the one boards wear) is the app's, loaded on first use, and an extension must
 * not import app code. Names are stored data, so an icon an extension saved keeps working when the
 * catalogue renames it, because the app resolves old names.
 */
export interface IconBridge {
	/** Draws the icon with this name, or nothing while the catalogue loads or for an unknown name. */
	Icon: ComponentType<{ name: string; size?: number; strokeWidth?: number }>
	/** An inline chooser: a search box and a grid. `null` means "no icon". */
	IconPicker: ComponentType<{ value: string; onPick: (name: string | null) => void }>
}

const Nothing = () => null

let bridge: IconBridge = { Icon: Nothing, IconPicker: Nothing }

/** Installed once by the app's composition root. Until then icons draw nothing. */
export function setIconBridge(next: IconBridge): void {
	bridge = next
}

export function getIconBridge(): IconBridge {
	return bridge
}
