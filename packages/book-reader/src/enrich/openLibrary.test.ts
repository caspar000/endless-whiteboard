import { describe, expect, it } from 'vitest'
import { parseSearchResponse, workUrl } from './openLibrary'

/** A doc shaped like Open Library's, with only the fields we ask for. */
const doc = {
	key: '/works/OL27448W',
	title: 'The Lord of the Rings',
	author_name: ['J.R.R. Tolkien'],
	first_publish_year: 1954,
	number_of_pages_median: 1216,
	isbn: ['0618640150', '9780618640157'],
	cover_i: 9255566,
}

describe('parseSearchResponse', () => {
	it('reads the fields a picker needs, and both cover sizes', () => {
		const [match] = parseSearchResponse({ docs: [doc] })
		expect(match).toEqual({
			key: '/works/OL27448W',
			title: 'The Lord of the Rings',
			author: 'J.R.R. Tolkien',
			year: 1954,
			pages: 1216,
			isbn: '0618640150',
			thumbnailUrl: 'https://covers.openlibrary.org/b/id/9255566-M.jpg',
			coverUrl: 'https://covers.openlibrary.org/b/id/9255566-L.jpg',
		})
	})

	it('keeps a record that is missing everything optional', () => {
		const [match] = parseSearchResponse({ docs: [{ key: '/works/OL1W', title: 'Anon' }] })
		expect(match).toMatchObject({
			title: 'Anon',
			author: '',
			year: null,
			pages: null,
			isbn: null,
			thumbnailUrl: null,
			coverUrl: null,
		})
	})

	it('drops records with nothing to click on', () => {
		const matches = parseSearchResponse({
			docs: [{ title: 'No key' }, { key: '/works/OL2W' }, { key: '/works/OL3W', title: '  ' }],
		})
		expect(matches).toEqual([])
	})

	it('survives every shape a third-party API can hand back', () => {
		// The point is that none of these throw — one bad response must cost the search, not the board.
		expect(parseSearchResponse(null)).toEqual([])
		expect(parseSearchResponse('nope')).toEqual([])
		expect(parseSearchResponse({})).toEqual([])
		expect(parseSearchResponse({ docs: 'not-an-array' })).toEqual([])
		expect(parseSearchResponse({ docs: [null, 42, 'x'] })).toEqual([])
	})

	it('ignores nonsense numbers rather than putting them on a card', () => {
		const [match] = parseSearchResponse({
			docs: [{ ...doc, first_publish_year: -5, number_of_pages_median: Number.NaN, cover_i: 'x' }],
		})
		expect(match).toMatchObject({ year: null, pages: null, coverUrl: null })
	})

	it('takes the first usable author and ISBN from their lists', () => {
		const [match] = parseSearchResponse({
			docs: [{ ...doc, author_name: ['', '  ', 'Ursula K. Le Guin'], isbn: ['', '123'] }],
		})
		expect(match).toMatchObject({ author: 'Ursula K. Le Guin', isbn: '123' })
	})
})

describe('workUrl', () => {
	it('points at the page a person would read', () => {
		expect(workUrl({ key: '/works/OL27448W' } as never)).toBe(
			'https://openlibrary.org/works/OL27448W'
		)
	})
})
