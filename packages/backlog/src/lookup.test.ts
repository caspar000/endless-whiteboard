import { setNetworkBridge } from '@lifeboard/node-kit'
import { describe, expect, it } from 'vitest'
import { bareQuery, byYear, cleanAlbumTitle, mergeFound, parseDeezer, parseItunes, parseMusicBrainz, parsePageImages, parseWikidataEntities, parseWikidataSearch, searchMedia, type Found } from './lookup'

/* The answers below are cut down from what each service sent for the acceptance's albums and films. */

const itunes = {
	resultCount: 2,
	results: [
		{
			wrapperType: 'collection',
			collectionId: 1803201468,
			artistName: 'Rob Clearfield',
			collectionName: 'Voice in the Wilderness (feat. Joe Sanders, Fred Pasqua & Itamar Borochov)',
			collectionViewUrl: 'https://music.apple.com/us/album/voice-in-the-wilderness/1803201468?uo=4',
			artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/46/cover.jpg/100x100bb.jpg',
			trackCount: 10,
			releaseDate: '2025-04-18T07:00:00Z',
		},
		{
			wrapperType: 'collection',
			collectionId: 1803201469,
			artistName: 'Rob Clearfield',
			collectionName: 'Voice in the Wilderness (Part 1) [feat. Itamar Borochov] - Single',
			artworkUrl100: '',
			trackCount: 1,
			releaseDate: '2025-02-07T08:00:00Z',
		},
		{ wrapperType: 'artist', artistName: 'Rob Clearfield' },
	],
}

const musicBrainz = {
	'release-groups': [
		{ id: '6d6dd661-9933-4e13-91ff-32132b8d4e49', score: 100, title: 'Ultra 85', 'primary-type': 'Album', 'first-release-date': '2024-08-09', 'artist-credit': [{ name: 'Logic' }] },
		{ id: '372b2a7c-de88-4001-a162-9ccbc25816a6', score: 100, title: 'OUT THERE', 'primary-type': 'Album', 'first-release-date': '2025-04-04', 'artist-credit': [{ name: 'Hiromi', joinphrase: ' feat. ' }, { name: 'Sonicwonder' }] },
		{ id: 'x', score: 40, title: 'Ultrasone S-Logic Demo', 'artist-credit': [{ name: 'Various Artists' }] },
	],
}

describe('music answers', () => {
	it('reads iTunes: no "feat.", a single said as one, the big cover, no tracking in the link', () => {
		const [album, single] = parseItunes(itunes)
		expect(album).toMatchObject({
			id: 'itunes:1803201468',
			title: 'Voice in the Wilderness',
			creator: 'Rob Clearfield',
			year: '2025',
			cover: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/46/cover.jpg/600x600bb.jpg',
			url: 'https://music.apple.com/us/album/voice-in-the-wilderness/1803201468',
			detail: '10 tracks',
			via: 'iTunes',
		})
		expect(single).toMatchObject({ title: 'Voice in the Wilderness (Part 1)', detail: 'Single · 1 track' })
		expect(parseItunes(itunes)).toHaveLength(2)
	})

	it('reads MusicBrainz, its cover from the Cover Art Archive, and drops weak matches', () => {
		const found = parseMusicBrainz(musicBrainz)
		expect(found.map((f) => [f.title, f.creator, f.year])).toEqual([
			['Ultra 85', 'Logic', '2024'],
			['OUT THERE', 'Hiromi', '2025'],
		])
		expect(found[0]!.cover).toBe('https://coverartarchive.org/release-group/6d6dd661-9933-4e13-91ff-32132b8d4e49/front-500')
	})

	it('reads Deezer', () => {
		const found = parseDeezer({ data: [{ id: 902119402, title: 'Ultra 85', link: 'https://www.deezer.com/album/902119402', cover_xl: 'https://cdn/x.jpg', nb_tracks: 17, record_type: 'album', artist: { name: 'Logic' } }] })
		expect(found).toEqual([{ id: 'deezer:902119402', title: 'Ultra 85', creator: 'Logic', year: '', cover: 'https://cdn/x.jpg', url: 'https://www.deezer.com/album/902119402', detail: '17 tracks', via: 'Deezer' }])
	})

	it('keeps an album found by several services once, filling in what the first lacked', () => {
		const a: Found = { id: 'deezer:1', title: 'OUT THERE', creator: 'Hiromi', year: '', cover: 'd.jpg', url: 'd', via: 'Deezer' }
		const b: Found = { id: 'musicbrainz:1', title: 'Out There', creator: 'HIROMI', year: '2025', cover: 'm.jpg', url: 'm', via: 'MusicBrainz' }
		expect(mergeFound([[a], [b]])).toEqual([{ ...a, year: '2025' }])
	})

	it('takes "feat." and " - EP" off a title', () => {
		expect(cleanAlbumTitle('OUT THERE (feat. Sonicwonder)')).toEqual({ title: 'OUT THERE', type: '' })
		expect(cleanAlbumTitle('Aquarius III - EP')).toEqual({ title: 'Aquarius III', type: 'EP' })
	})

	it('searches with what names the album, not "album" or dashes', () => {
		expect(bareQuery('Hiromi - Out There album')).toBe('Hiromi Out There')
		expect(bareQuery('Prince 1999')).toBe('Prince 1999')
		expect(bareQuery('Ностальгия 1983 by tarkovsky', { year: true })).toBe('Ностальгия tarkovsky')
	})
})

const entities = {
	entities: {
		Q12870596: {
			labels: { en: { language: 'en', value: 'The Eccentrics' } },
			descriptions: { en: { language: 'en', value: '1973 film by Eldar Shengelaya' } },
			claims: {
				P577: [{ mainsnak: { datavalue: { value: { time: '+1973-00-00T00:00:00Z' } } } }],
				P57: [{ mainsnak: { datavalue: { value: { id: 'Q651895' } } } }],
				P345: [{ mainsnak: { datavalue: { value: 'tt0175157' } } }],
				P1476: [{ mainsnak: { datavalue: { value: { text: 'შერეკილები', language: 'ka' } } } }],
			},
			sitelinks: { kawiki: { site: 'kawiki', title: 'შერეკილები' }, enwiki: { site: 'enwiki', title: 'The Eccentrics' }, commonswiki: { site: 'commonswiki', title: 'Category:X' } },
		},
		Q24053277: {
			labels: { mul: { language: 'mul', value: 'Three Billboards Outside Ebbing, Missouri' } },
			descriptions: { en: { language: 'en', value: '2017 film directed by Martin McDonagh' } },
			claims: {
				P577: [{ mainsnak: { datavalue: { value: { time: '+2018-01-25T00:00:00Z' } } } }, { mainsnak: { datavalue: { value: { time: '+2017-12-01T00:00:00Z' } } } }],
				P1476: [{ mainsnak: { datavalue: { value: { text: 'Three Billboards Outside Ebbing, Missouri', language: 'en' } } } }],
			},
			sitelinks: {},
		},
	},
}

describe('film answers', () => {
	it('reads the search', () => {
		expect(parseWikidataSearch({ query: { search: [{ title: 'Q1138968' }, { title: 'Property:P1' }] } })).toEqual(['Q1138968'])
	})

	it('reads a film: its English title, its own when that differs, its first year, its director, its articles English first', () => {
		const [eccentrics, billboards] = parseWikidataEntities(entities, ['Q12870596', 'Q24053277', 'Q404'])
		expect(eccentrics).toEqual({
			id: 'Q12870596',
			title: 'The Eccentrics',
			original: 'შერეკილები',
			year: '1973',
			directedBy: 'Eldar Shengelaya',
			directors: ['Q651895'],
			imdb: 'tt0175157',
			articles: [
				{ wiki: 'enwiki', title: 'The Eccentrics' },
				{ wiki: 'kawiki', title: 'შერეკილები' },
			],
			commonsPoster: '',
		})
		expect(billboards).toMatchObject({ title: 'Three Billboards Outside Ebbing, Missouri', original: '', year: '2017', directedBy: 'Martin McDonagh' })
	})

	it('reads a poster, under the title it was asked by', () => {
		const images = parsePageImages({
			query: { normalized: [{ from: 'the Eccentrics', to: 'The Eccentrics' }], pages: [{ title: 'The Eccentrics', thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/en/d/d2/Chudaki.jpg?utm_source=en.wikipedia.org' } }] },
		})
		expect(images.get('the Eccentrics')).toBe('https://upload.wikimedia.org/wikipedia/en/d/d2/Chudaki.jpg')
	})

	it('puts a film from about the year asked first', () => {
		const film = (year: string) => ({ id: year, title: 'Ностальгия', creator: '', year, cover: '', url: '', via: '' })
		expect(byYear([film('2022'), film('1973')], '1974 შერეკილები').map((f) => f.year)).toEqual(['1973', '2022'])
	})
})

describe('a search', () => {
	it('asks each service once for a query, and not again for the same query', async () => {
		const asked: string[] = []
		setNetworkBridge({
			getJson: async (url) => {
				asked.push(new URL(url).host)
				return url.includes('itunes') ? itunes : url.includes('musicbrainz') ? { 'release-groups': [] } : null
			},
			getBlob: async () => null,
			getText: async () => ({ ok: false, reason: 'unavailable', message: '' }),
		})
		const found = await searchMedia('music', 'Rob Clearfield Voice in the Wilderness album')
		expect(found[0]).toMatchObject({ title: 'Voice in the Wilderness', creator: 'Rob Clearfield' })
		expect(asked.sort()).toEqual(['itunes.apple.com', 'musicbrainz.org'])
		await searchMedia('music', 'Rob Clearfield Voice in the Wilderness album')
		expect(asked).toHaveLength(2)
	})
})
