import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const THEMES = ['light', 'dark'] as const
export type Theme = (typeof THEMES)[number]

/**
 * Each server board's preview images, one file per board and theme, so every device shows a board's
 * card with a picture of it in its own theme, including devices that have never opened it. Whichever
 * device last drew one sends it. When it was drawn travels with it, so a device can tell a preview
 * drawn before the board's last edit and draw a fresh one.
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
		const path = this.path(boardId, theme)
		if (!existsSync(path)) return null
		return { bytes: readFileSync(path), drawnAt: Math.floor(statSync(path).mtimeMs) }
	}

	write(boardId: string, theme: Theme, bytes: Buffer): void {
		// Written aside and renamed, so a reader never gets half an image.
		const temp = `${this.path(boardId, theme)}.${process.pid}.tmp`
		writeFileSync(temp, bytes)
		renameSync(temp, this.path(boardId, theme))
	}

	delete(boardId: string): void {
		for (const theme of THEMES) rmSync(this.path(boardId, theme), { force: true })
		// From before previews had a theme.
		rmSync(join(this.dir, `${boardId}.webp`), { force: true })
	}
}
