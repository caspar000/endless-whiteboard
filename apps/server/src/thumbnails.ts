import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const THEMES = ['light', 'dark'] as const
export type Theme = (typeof THEMES)[number]

/**
 * Each server board's preview images, one file per board and theme, so every device shows a board's
 * card with a picture of it in its own theme, including devices that have never opened it. Whichever
 * device last drew one sends it. When it was drawn travels with it, so a device can tell a preview
 * drawn before the board's last edit and draw a fresh one.
 *
 * The drawn-at time is the file's mtime and doubles as the preview's version: the board list carries
 * it, and a request naming it can be cached by the browser for good (`api.ts`).
 */
export class Thumbnails {
	constructor(private readonly dir: string) {
		mkdirSync(dir, { recursive: true })
	}

	/** Board ids are checked against `BOARD_ID` before they get here; they are file-safe. */
	private path(boardId: string, theme: Theme): string {
		return join(this.dir, `${boardId}.${theme}.webp`)
	}

	read(boardId: string, theme: Theme): { bytes: Buffer; drawnAt: number } | null {
		const drawnAt = this.drawnAt(boardId, theme)
		return drawnAt === null ? null : { bytes: readFileSync(this.path(boardId, theme)), drawnAt }
	}

	/** When the board's preview in `theme` was drawn (the file's mtime), or `null` if it has none. */
	drawnAt(boardId: string, theme: Theme): number | null {
		const stat = statSync(this.path(boardId, theme), { throwIfNoEntry: false })
		return stat ? Math.floor(stat.mtimeMs) : null
	}

	/** Each theme's drawn-at time, for the board list: a device knows which preview is current without asking. */
	versions(boardId: string): Partial<Record<Theme, number>> {
		const versions: Partial<Record<Theme, number>> = {}
		for (const theme of THEMES) {
			const drawnAt = this.drawnAt(boardId, theme)
			if (drawnAt !== null) versions[theme] = drawnAt
		}
		return versions
	}

	/** Returns the new drawn-at time, the version the board list will carry from now on. */
	write(boardId: string, theme: Theme, bytes: Buffer): number {
		// Written aside and renamed, so a reader never gets half an image.
		const temp = `${this.path(boardId, theme)}.${process.pid}.tmp`
		writeFileSync(temp, bytes)
		renameSync(temp, this.path(boardId, theme))
		return this.drawnAt(boardId, theme)!
	}

	delete(boardId: string): void {
		for (const theme of THEMES) rmSync(this.path(boardId, theme), { force: true })
		// From before previews had a theme.
		rmSync(join(this.dir, `${boardId}.webp`), { force: true })
	}
}
