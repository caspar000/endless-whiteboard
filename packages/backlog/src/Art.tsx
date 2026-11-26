import { generatedCover, useItemCover, type SourceEntry, type SourceKind } from '@lifeboard/node-kit'
import { useState } from 'react'

type Item = Pick<SourceEntry, 'title' | 'creator' | 'year' | 'cover'>

/** A cover, or one drawn from the title when there is none or it fails to load (MusicBrainz has no art for many albums). */
export function Art({ item, shape = 'square', className }: { item: Item; shape?: SourceKind['shape']; className?: string }) {
	const url = useItemCover(item, shape)
	const [failed, setFailed] = useState('')
	return <img className={className ?? 'lb-backlog__art'} src={failed === url ? generatedCover(item, shape) : url} alt="" draggable={false} loading="lazy" onError={() => setFailed(url)} />
}
