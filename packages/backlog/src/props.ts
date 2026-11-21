export const BACKLOG_TYPE = 'node.backlog'

export interface BacklogProps {
	/** The backlog this card shows, kept in the vault (`store.ts`). A copy of the card shows the same one. */
	backlogId: string
	/** See registry.tsx: `h` follows the card until a vertical handle pins it. */
	autoHeight: boolean
}
