import { BookOpen, Clapperboard, Disc3, Drama, Dumbbell, FileText, Gamepad2, Landmark, MapPin, Mic, type LucideIcon } from 'lucide-react'
import { getItem, type ItemDef } from '../syllabus'

const ICONS: Record<string, LucideIcon> = {
	book: BookOpen,
	film: Clapperboard,
	album: Disc3,
	play: Drama,
	game: Gamepad2,
	exercise: Dumbbell,
	talk: Mic,
	visit: MapPin,
	artefact: Landmark,
}

/**
 * The icon for what an item is: a book, a film, an album. A work whose medium is just `work` (a
 * dialogue of Plato's) is what its entry is; anything else unnamed is a page.
 */
export function mediumIcon(item: ItemDef): LucideIcon {
	let at: ItemDef | undefined = item
	for (let guard = 0; at && guard < 8; guard++) {
		const icon = ICONS[at.medium.toLowerCase()]
		if (icon) return icon
		at = at.parent ? getItem(at.parent) : undefined
	}
	return FileText
}
