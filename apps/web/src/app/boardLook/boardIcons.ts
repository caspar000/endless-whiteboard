import { useEffect, useSyncExternalStore } from 'react'

/**
 * The icons a board can wear on its tab, its sidebar row and its card: every outline icon of Tabler
 * (tabler.io/icons, MIT), some 4,700 once the crossed-out variants are left out, each searchable by
 * its name, its category and Tabler's own tags. They load on first use, as one chunk (`tablerIcons.json`, written by
 * scripts/build-board-icons.mjs), so a page with no icons on it pays nothing for them.
 *
 * A board stores the icon's name, so a name here is stored data. Boards first stored Lucide's names;
 * `RENAMED` maps those that Tabler does not share to its nearest icon, so no board loses its icon.
 */
export type IconPath = string | [d: string, attributes: Record<string, string>]

export interface BoardIcon {
	name: string
	category: string
	/** Everything it can be found by: its name, category and tags, and our own words for it. */
	words: string
	paths: readonly IconPath[]
}

export interface IconCatalogue {
	icons: readonly BoardIcon[]
	byName: ReadonlyMap<string, BoardIcon>
	/** Tabler's categories, the ones a board is likeliest to want first. */
	categories: readonly string[]
}

/** Lucide names boards stored before the catalogue moved to Tabler, by the Tabler icon they now show. */
const RENAMED: Readonly<Record<string, string>> = {
	'building-2': 'building',
	'timer': 'stopwatch',
	'list-todo': 'list-check',
	'square-check-big': 'square-check',
	'kanban': 'layout-kanban',
	'user-round': 'user',
	'handshake': 'heart-handshake',
	'megaphone': 'speakerphone',
	'message-square': 'message',
	'lightbulb': 'bulb',
	'zap': 'bolt',
	'landmark': 'building-bank',
	'laptop': 'device-laptop',
	'monitor': 'device-desktop',
	'smartphone': 'device-mobile',
	'tablet': 'device-tablet',
	'gamepad-2': 'device-gamepad-2',
	'joystick': 'device-gamepad-3',
	'bot': 'robot',
	'layers': 'stack-2',
	'pen-tool': 'vector-bezier',
	'paintbrush': 'paint',
	'wrench': 'tool',
	'cog': 'settings',
	'clapperboard': 'movie',
	'film': 'movie',
	'mic': 'microphone',
	'book-open': 'book-2',
	'notebook-pen': 'notebook',
	'newspaper': 'news',
	'graduation-cap': 'school',
	'languages': 'language',
	'pen-line': 'writing',
	'highlighter': 'highlight',
	'flask-conical': 'flask',
	'sigma': 'math-function',
	'scroll-text': 'script',
	'house': 'home',
	'cooking-pot': 'cooker',
	'utensils-crossed': 'tools-kitchen-2',
	'wine': 'glass-full',
	'store': 'building-store',
	'party-popper': 'confetti',
	'baby': 'baby-carriage',
	'footprints': 'shoe',
	'piggy-bank': 'pig-money',
	'banknote': 'cash',
	'train-front': 'train',
	'hotel': 'building-skyscraper',
	'paw-print': 'paw',
	'bird': 'feather',
	'rabbit': 'carrot',
	'heart-pulse': 'heartbeat',
	'syringe': 'vaccine',
	'smile': 'mood-smile',
	'mountain-snow': 'snowflake',
	'waves': 'ripple',
	'volleyball': 'ball-volleyball',
	'goal': 'soccer-field',
	'music-2': 'music',
	'guitar': 'guitar-pick',
	'drum': 'music',
	'speaker': 'device-speaker',
	'disc-3': 'disc',
	'list-music': 'playlist',
	'audio-waveform': 'wave-sine',
	'sliders-horizontal': 'adjustments-horizontal',
	'mic-2': 'microphone-2',
	'wand-2': 'wand',
	'castle': 'building-castle',
	'drama': 'masks-theater',
	'tv': 'device-tv',
	'popcorn': 'movie',
	'image': 'photo',
	'images': 'photo-plus',
	'tree-pine': 'christmas-tree',
	'tree-palm': 'beach',
	'flower-2': 'flower',
	'sprout': 'seedling',
	'shell': 'beach',
	'earth': 'world',
	'globe-2': 'world',
	'church': 'building-church',
	'factory': 'building-factory',
	'warehouse': 'building-warehouse',
	'info': 'info-circle',
	'circle-help': 'help-circle',
	'triangle-alert': 'alert-triangle',
	'unlock': 'lock-open',
	'at-sign': 'at',
	'gem': 'diamond',
	'frown': 'mood-sad',
	'laugh': 'mood-happy',
	'angry': 'mood-angry',
	'thumbs-up': 'thumb-up',
	'hand': 'hand-stop'
}

/** The name to look an icon up by, whichever catalogue it was stored from. */
export const iconName = (stored: string | undefined): string | undefined => (stored ? (RENAMED[stored] ?? stored) : undefined)

/**
 * The picker's first page: a few hundred picked by hand, in groups, with the words someone might type
 * for them ("gym" finds the dumbbell) added to Tabler's own.
 */
export const SUGGESTED: readonly (readonly [group: string, entries: readonly (readonly [name: string, words: string])[]])[] = [
	['Work', [
		['briefcase', 'job office career business'],
		['building', 'building 2 company office workplace'],
		['presentation', 'slides meeting pitch'],
		['calendar', 'date schedule plan'],
		['calendar-check', 'deadline event done'],
		['clock', 'time hours'],
		['stopwatch', 'timer pomodoro focus countdown training interval'],
		['clipboard-list', 'tasks todo checklist'],
		['list-check', 'list todo tasks todo checklist'],
		['square-check', 'square check big done task complete'],
		['target', 'goal aim objective'],
		['flag', 'milestone goal mark flag'],
		['trophy', 'win award achievement competition sport'],
		['medal', 'award prize race medal sport'],
		['chart-line', 'growth stats analytics'],
		['chart-bar', 'stats chart metrics'],
		['chart-pie', 'share stats budget'],
		['trending-up', 'growth increase progress'],
		['layout-kanban', 'kanban board tasks workflow'],
		['network', 'org structure connections'],
		['users', 'team people group'],
		['user', 'user round person profile me'],
		['heart-handshake', 'handshake deal partner client'],
		['speakerphone', 'megaphone marketing announce campaign'],
		['mail', 'email inbox message'],
		['inbox', 'mail queue'],
		['message', 'message square chat message comment'],
		['phone', 'call contact'],
		['bulb', 'lightbulb idea brainstorm insight'],
		['brain', 'mind thinking learning mental health'],
		['puzzle', 'problem solve puzzle games'],
		['rocket', 'launch startup ship project'],
		['bolt', 'zap energy fast power lightning'],
		['sparkles', 'magic new ideas'],
		['compass', 'direction strategy explore'],
		['map', 'plan route travel'],
		['scale', 'law balance decide weight body'],
		['gavel', 'law legal'],
		['building-bank', 'landmark bank government'],
	]],
	['Making & tech', [
		['code', 'programming dev software'],
		['terminal', 'command line dev shell'],
		['bug', 'debug issue error'],
		['git-branch', 'git version code'],
		['database', 'data storage'],
		['server', 'backend hosting'],
		['cloud', 'cloud online sync weather sky'],
		['cpu', 'hardware computer chip'],
		['device-laptop', 'laptop computer work'],
		['device-desktop', 'monitor screen desktop'],
		['device-mobile', 'smartphone phone mobile app'],
		['device-tablet', 'tablet ipad device'],
		['keyboard', 'typing input'],
		['mouse', 'computer pointer'],
		['device-gamepad-2', 'gamepad 2 games gaming play console'],
		['device-gamepad-3', 'joystick arcade games retro'],
		['robot', 'bot robot ai automation'],
		['wifi', 'internet network'],
		['globe', 'web world internet'],
		['link', 'url web'],
		['stack-2', 'layers stack design'],
		['layout-grid', 'layout grid ui'],
		['vector-bezier', 'pen tool design vector'],
		['palette', 'art colour design paint'],
		['brush', 'paint art painting'],
		['paint', 'paintbrush paint art craft'],
		['pencil', 'draw write sketch'],
		['ruler', 'measure design'],
		['scissors', 'cut craft'],
		['hammer', 'build diy tools'],
		['tool', 'wrench fix repair tools'],
		['settings', 'gear config'],
		['box', 'package product 3d'],
		['package', 'shipping delivery box'],
		['printer', 'print 3d'],
		['camera', 'photo photography'],
		['aperture', 'photo lens camera'],
		['video', 'film record'],
		['movie', 'clapperboard film movie cinema'],
		['microphone', 'mic podcast voice record'],
		['radio', 'broadcast'],
		['engine', 'car motor mechanic garage'],
	]],
	['Learning & writing', [
		['book', 'read book'],
		['book-2', 'book open reading study'],
		['library', 'books collection'],
		['notebook', 'notes journal'],
		['file-text', 'document doc'],
		['news', 'newspaper news article'],
		['bookmark', 'saved read later'],
		['school', 'graduation cap school university study'],
		['language', 'languages language translate'],
		['quote', 'quotes citation'],
		['feather', 'writing poetry light feather'],
		['writing', 'pen line write signature'],
		['highlight', 'highlighter study notes'],
		['microscope', 'science research lab'],
		['flask', 'flask conical chemistry science lab experiment'],
		['atom', 'physics science atom'],
		['dna', 'biology genetics'],
		['telescope', 'astronomy space'],
		['calculator', 'math numbers'],
		['math-function', 'sigma math sum formula'],
		['infinity', 'math loop forever'],
		['search', 'research find'],
		['archive', 'history storage'],
		['history', 'past timeline'],
		['hourglass', 'time patience'],
		['script', 'scroll text history scroll'],
	]],
	['Home & life', [
		['home', 'house home house'],
		['sofa', 'living room furniture interior'],
		['bed', 'bedroom sleep'],
		['bath', 'bathroom'],
		['lamp', 'lighting interior'],
		['armchair', 'furniture chair'],
		['cooker', 'cooking pot cooking kitchen recipes'],
		['chef-hat', 'cooking chef recipes'],
		['tools-kitchen-2', 'utensils crossed food restaurant eat'],
		['pizza', 'food pizza'],
		['coffee', 'coffee cafe morning'],
		['glass-full', 'wine wine drinks'],
		['beer', 'beer drinks pub'],
		['cake', 'birthday cake party'],
		['apple', 'fruit food health'],
		['carrot', 'vegetable food garden'],
		['salad', 'healthy food diet nutrition'],
		['shopping-cart', 'shopping groceries buy'],
		['shopping-bag', 'shopping store'],
		['building-store', 'store shop retail'],
		['gift', 'present birthday christmas'],
		['confetti', 'party popper party celebration'],
		['baby-carriage', 'baby baby kids child'],
		['heart', 'love favourite like'],
		['shirt', 'clothes fashion wardrobe'],
		['shoe', 'footprints walk steps running walking'],
		['key', 'keys security home'],
		['lock', 'private secure locked'],
		['wallet', 'money finance spending'],
		['pig-money', 'piggy bank savings money budget'],
		['credit-card', 'payments card money'],
		['cash', 'banknote cash money'],
		['coins', 'money savings'],
		['receipt', 'expenses bills'],
		['car', 'car drive vehicle'],
		['bike', 'bicycle cycling ride'],
		['bus', 'transport commute'],
		['train', 'train front train travel'],
		['plane', 'travel flight trip'],
		['ship', 'boat cruise travel'],
		['luggage', 'travel trip packing'],
		['tent', 'camping outdoors camp'],
		['building-skyscraper', 'hotel travel stay'],
		['map-pin', 'place location'],
		['navigation', 'directions gps'],
		['ticket', 'event concert tickets'],
		['dog', 'dog pet'],
		['cat', 'cat pet'],
		['paw', 'paw print pets animals'],
		['fish', 'fish pet aquarium'],
	]],
	['Health & sport', [
		['dumbbell', 'gym fitness workout weights exercise'],
		['heartbeat', 'heart pulse health cardio heart'],
		['activity', 'fitness health tracking'],
		['stethoscope', 'doctor medical health'],
		['pill', 'medicine pills health'],
		['vaccine', 'syringe vaccine medical'],
		['hospital', 'hospital medical'],
		['bone', 'bones physio body'],
		['mood-smile', 'smile happy mood smile'],
		['leaf', 'calm nature mindful plant eco'],
		['moon', 'sleep night moon'],
		['sun', 'morning day energy sun summer'],
		['mountain', 'hiking climbing outdoors mountains landscape'],
		['snowflake', 'mountain snow ski snow mountains'],
		['ripple', 'waves swimming sea surf ocean'],
		['ball-volleyball', 'volleyball volleyball sport'],
		['swords', 'martial arts fencing fight rpg fantasy battle'],
		['shield', 'defence protect security safe'],
		['soccer-field', 'goal football soccer goal'],
		['flame', 'calories burn streak fire hot'],
		['droplet', 'water hydration'],
		['weight', 'weight lifting'],
		['barbell', 'gym weights lifting strength'],
		['yoga', 'stretch mindful exercise'],
		['swimming', 'swim pool'],
		['run', 'running jog'],
	]],
	['Music & play', [
		['music', 'music songs'],
		['guitar-pick', 'guitar guitar music band'],
		['piano', 'piano keys music'],
		['headphones', 'listen music audio'],
		['device-speaker', 'speaker sound audio'],
		['disc', 'disc 3 album vinyl record'],
		['playlist', 'list music playlist music'],
		['wave-sine', 'audio waveform audio sound production'],
		['adjustments-horizontal', 'sliders horizontal mixer mixing sliders'],
		['microphone-2', 'mic 2 sing vocal karaoke'],
		['dice-5', 'board games dice'],
		['crown', 'chess king royal premium'],
		['ghost', 'halloween spooky ghost'],
		['wand', 'wand 2 magic fantasy'],
		['building-castle', 'castle fantasy castle history'],
		['skull', 'horror pirate skull danger'],
		['masks-theater', 'drama theatre acting'],
		['device-tv', 'tv tv shows series'],
		['photo', 'image pictures gallery'],
		['photo-plus', 'images gallery moodboard'],
	]],
	['Nature & places', [
		['trees', 'forest woods'],
		['christmas-tree', 'tree pine pine forest christmas'],
		['beach', 'tree palm beach tropical holiday'],
		['flower', 'flower garden'],
		['seedling', 'sprout growth plant seedling garden'],
		['clover', 'luck clover'],
		['cloud-rain', 'rain weather'],
		['wind', 'wind air'],
		['rainbow', 'rainbow colour'],
		['umbrella', 'rain beach'],
		['thermometer', 'temperature weather'],
		['world', 'earth world planet globe'],
		['orbit', 'space orbit'],
		['satellite', 'space satellite'],
		['star', 'star favourite night important'],
		['sparkle', 'sparkle shine'],
		['sunrise', 'morning sunrise'],
		['sunset', 'evening sunset'],
		['building-church', 'church church religion'],
		['building-factory', 'factory industry factory'],
		['building-warehouse', 'warehouse warehouse storage'],
		['anchor', 'sea sailing harbour anchor stable'],
		['sailboat', 'sailing boat sea yacht'],
	]],
	['Symbols', [
		['bell', 'notifications reminder'],
		['info-circle', 'info info about'],
		['help-circle', 'circle help question help'],
		['alert-triangle', 'triangle alert warning caution'],
		['circle-check', 'done ok'],
		['circle-x', 'no cancel'],
		['ban', 'forbidden block'],
		['eye', 'watch see'],
		['lock-open', 'unlock open public'],
		['fingerprint', 'identity security'],
		['tag', 'label tag'],
		['hash', 'hashtag number'],
		['at', 'at sign email mention'],
		['asterisk', 'note star'],
		['circle', 'circle shape'],
		['square', 'square shape'],
		['triangle', 'triangle shape'],
		['hexagon', 'hexagon shape'],
		['diamond', 'diamond gem'],
		['award', 'badge award'],
		['recycle', 'recycle eco'],
		['mood-sad', 'frown sad'],
		['mood-happy', 'laugh laugh fun'],
		['mood-angry', 'angry angry'],
		['thumb-up', 'thumbs up like approve'],
		['hand-stop', 'hand hand stop'],
		['droplets', 'water liquid'],
	]],
]

/** Categories by how likely a board is to be about them; Tabler's own order is alphabetical. */
const CATEGORY_ORDER = [
	'Sport', 'Health', 'Vehicles', 'Food', 'Nature', 'Animals', 'Buildings', 'Map', 'Devices', 'Computers',
	'Media', 'Photography', 'Games', 'Mood', 'Weather', 'E-commerce', 'Currencies', 'Design', 'Document',
	'Communication', 'Development', 'Database', 'Charts', 'Math', 'Electrical', 'Laundry', 'Symbols',
	'Badges', 'Zodiac', 'Gender', 'Gestures', 'Brand', 'Shapes', 'Text', 'Letters', 'Numbers', 'Arrows',
	'System', 'Version control', 'Extensions', 'Logic',
]
/** Tabler leaves some icons without a category. */
export const OTHER = 'Other'

let catalogue: IconCatalogue | null = null
let loading: Promise<IconCatalogue> | null = null
const listeners = new Set<() => void>()

function build(icons: [string, string, string, IconPath[]][]): IconCatalogue {
	const ours = new Map(SUGGESTED.flatMap(([, entries]) => entries))
	const list = icons.map(([name, category, tags, paths]) => ({
		name,
		category: category || OTHER,
		words: `${name.replace(/-/g, ' ')} ${(category || OTHER).toLowerCase()} ${tags} ${ours.get(name) ?? ''}`.trim(),
		paths,
	}))
	const present = new Set(list.map((icon) => icon.category))
	const rank = (category: string) => {
		const at = CATEGORY_ORDER.indexOf(category)
		return at === -1 ? CATEGORY_ORDER.length : at
	}
	return {
		icons: list,
		byName: new Map(list.map((icon) => [icon.name, icon])),
		categories: [...present].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)),
	}
}

/** The catalogue, loading it the first time it is asked for. A failed load can be tried again. */
export function loadBoardIcons(): Promise<IconCatalogue> {
	loading ??= import('./tablerIcons.json')
		.then(({ default: data }) => {
			catalogue = build(data.icons as [string, string, string, IconPath[]][])
			for (const listener of listeners) listener()
			return catalogue
		})
		.catch((error: unknown) => {
			loading = null
			throw error
		})
	return loading
}

/** The catalogue once it has loaded, `null` until then. Asking starts the load, unless `needed` is false. */
export function useBoardIcons(needed = true): IconCatalogue | null {
	const loaded = useSyncExternalStore(
		(listener) => {
			listeners.add(listener)
			return () => listeners.delete(listener)
		},
		() => catalogue
	)
	useEffect(() => {
		if (needed && !catalogue) loadBoardIcons().catch((error: unknown) => console.warn('Lifeboard: could not load the board icons', error))
	}, [needed])
	return loaded
}

/** At most this many results are drawn, so a short query never puts thousands of icons on screen. */
export const SEARCH_LIMIT = 240

/**
 * Icons matching every word typed, each word matching the start of one of the icon's words. The
 * closest first: the name itself, then names that start with the query, then names that contain its
 * words, then tags. An empty query matches nothing; the picker shows its suggestions instead.
 */
export function searchBoardIcons(
	{ icons }: IconCatalogue,
	query: string
): { icons: readonly BoardIcon[]; total: number } {
	const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
	if (!terms.length) return { icons: [], total: 0 }
	const joined = terms.join('-')
	const scored: { icon: BoardIcon; score: number }[] = []
	for (const icon of icons) {
		const words = icon.words.split(' ')
		if (!terms.every((term) => words.some((word) => word.startsWith(term)))) continue
		const nameWords = icon.name.split('-')
		const score =
			icon.name === joined ? 0
			: icon.name.startsWith(joined) ? 1
			: terms.every((term) => nameWords.some((word) => word.startsWith(term))) ? 2
			: 3
		scored.push({ icon, score })
	}
	scored.sort((a, b) => a.score - b.score || a.icon.name.length - b.icon.name.length || a.icon.name.localeCompare(b.icon.name))
	return { icons: scored.slice(0, SEARCH_LIMIT).map(({ icon }) => icon), total: scored.length }
}
