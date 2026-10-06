import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Each server board's preview image, one file per board, so every device shows a board's card with a
 * picture of it, including devices that have never opened it. Whichever device last drew one sends it.
 */
export class Thumbnails {
	constructor(private readonly dir: string) {
		mkdirSync(dir, { recursive: true })
	}

	/** Board ids are checked against `BOARD_ID` before they get here; they are file-safe. */
	private path(boardId: string): string {
		return join(this.dir, `${boardId}.webp`)
	}

	read(boardId: string): Buffer | null {
		return existsSync(this.path(boardId)) ? readFileSync(this.path(boardId)) : null
	}

	write(boardId: string, bytes: Buffer): void {
		// Written aside and renamed, so a reader never gets half an image.
		const temp = `${this.path(boardId)}.${process.pid}.tmp`
		writeFileSync(temp, bytes)
		renameSync(temp, this.path(boardId))
	}

	delete(boardId: string): void {
		rmSync(this.path(boardId), { force: true })
	}
}
