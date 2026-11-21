export const RANKING_TYPE = 'node.ranking'

export interface RankingProps {
	/** The ranking this card shows, kept in the vault (`store.ts`). A copy of the card shows the same one. */
	rankingId: string
	/** See registry.tsx: `h` follows the card until a vertical handle pins it. */
	autoHeight: boolean
}
