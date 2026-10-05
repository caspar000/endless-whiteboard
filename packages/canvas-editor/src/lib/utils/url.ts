import { safeParseUrl } from '@tldraw/utils'

/** Whether a string parses as an absolute URL. The 2023 utils package had this; today's has `safeParseUrl`. */
export function isValidUrl(url: string) {
	return safeParseUrl(url) !== undefined
}
