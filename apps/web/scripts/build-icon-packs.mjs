// Writes src/app/boardLook/iconPacks.json: the icon packs that sit beside Tabler in the catalogue, each
// a hand-picked set drawn from one or two open icon sets. Run after changing a pack below, or after
// upgrading one of the packages it reads:
//
//   node scripts/build-icon-packs.mjs
//
// A pack icon's name is stored data (a board's icon, an icon task's): the app stores it as
// `<pack>:<name>`, so rename one only with a mapping in boardIcons.ts, as RENAMED does for Tabler.
//
// - Activities: pictograms of sports and exercise, in the style of Olympic sport signs. Material
//   Symbols and Material Design Icons (both Apache-2.0), and one from Temaki (CC0).
// - Everyday: things done around the day, from brushing teeth to taking the bins out. Fluent Emoji High
//   Contrast (MIT), and a few from Tabler (MIT) where no emoji draws the thing.
import { readFileSync, writeFileSync } from 'node:fs'
import { svgPathBbox } from 'svg-path-bbox'

const MS = 'material-symbols'
const MDI = 'mdi'
const FE = 'fluent-emoji-high-contrast'
const TK = 'temaki'
const TB = 'tabler'

/** Each pack: its groups, each icon as [our name, `set:name` it is drawn from, words it is found by]. */
const PACKS = [
	{
		id: 'activities',
		name: 'Activities',
		groups: [
			['Water', [
				['swimming', `${MS}:pool`, 'swim pool laps'],
				['diving', `${MDI}:diving`, 'dive platform'],
				['scuba-diving', `${MS}:scuba-diving`, 'scuba snorkel'],
				['water-polo', `${MDI}:water-polo`, 'polo'],
				['rowing', `${MS}:rowing`, 'row boat'],
				['kayaking', `${MS}:kayaking`, 'canoe paddle'],
				['surfing', `${MS}:surfing`, 'surf wave'],
				['kitesurfing', `${MS}:kitesurfing`, 'kite'],
				['sailing', `${MS}:sailing`, 'sail boat'],
				['water-skiing', `${MDI}:ski-water`, 'wakeboard'],
			]],
			['On foot and wheels', [
				['running', `${MS}:directions-run`, 'run jog cardio'],
				['sprinting', `${MS}:sprint`, 'sprint fast run'],
				['walking', `${MS}:directions-walk`, 'walk steps'],
				['nordic-walking', `${MS}:nordic-walking`, 'poles'],
				['hiking', `${MS}:hiking`, 'hike trek mountain'],
				['cycling', `${MS}:directions-bike`, 'bike bicycle ride'],
				['track-cycling', `${MDI}:bike-fast`, 'bike race spin'],
				['skateboarding', `${MS}:skateboarding`, 'skate'],
				['roller-skating', `${MS}:roller-skating`, 'rollerblade'],
				['climbing', `${TK}:climbing`, 'climb boulder wall'],
				['paragliding', `${MS}:paragliding`, 'paraglide fly'],
			]],
			['Gym and body', [
				['weightlifting', `${MDI}:weight-lifter`, 'lift barbell gym strength'],
				['gym', `${MS}:fitness-center`, 'dumbbell workout strength'],
				['kettlebell', `${MDI}:kettlebell`, 'swing'],
				['jump-rope', `${MDI}:jump-rope`, 'skipping cardio'],
				['gymnastics', `${MS}:sports-gymnastics`, 'gymnast'],
				['yoga', `${MDI}:yoga`, 'stretch pose'],
				['meditation', `${MS}:self-improvement`, 'meditate mindfulness lotus calm'],
				['stretching', `${MS}:accessibility-new`, 'stretch arms mobility'],
				['physiotherapy', `${MS}:physical-therapy`, 'physio rehab'],
				['dancing', `${MDI}:human-female-dance`, 'dance'],
				['ballroom-dancing', `${MDI}:dance-ballroom`, 'dance partner'],
			]],
			['Combat', [
				['martial-arts', `${MS}:sports-martial-arts`, 'kick taekwondo'],
				['karate', `${MDI}:karate`, 'punch'],
				['wrestling', `${MS}:sports-kabaddi`, 'grapple judo kabaddi'],
				['boxing', `${MS}:sports-mma`, 'glove punch'],
				['kendo', `${MS}:swords`, 'sword fencing'],
				['fencing', `${MDI}:fencing`, 'foil epee sabre'],
				['archery', `${MDI}:bow-arrow`, 'bow arrow'],
			]],
			['Ball and racket', [
				['football', `${MS}:sports-soccer`, 'soccer ball'],
				['basketball', `${MS}:sports-basketball`, 'hoops'],
				['volleyball', `${MS}:sports-volleyball`, 'beach'],
				['handball', `${MS}:sports-handball`, 'throw'],
				['tennis', `${MS}:sports-tennis`, 'racket'],
				['badminton', `${MS}:badminton`, 'shuttlecock'],
				['table-tennis', `${MDI}:table-tennis`, 'ping pong'],
				['padel', `${MS}:padel`, 'racket'],
				['golf', `${MDI}:golf`, 'flag hole'],
				['baseball', `${MS}:sports-baseball`, 'bat'],
				['american-football', `${MS}:sports-football`, 'nfl'],
				['rugby', `${MS}:sports-rugby`, 'ball'],
				['hockey', `${MS}:sports-hockey`, 'stick puck'],
				['cricket', `${MS}:sports-cricket`, 'bat'],
				['bowling', `${MDI}:bowling`, 'pins'],
			]],
			['Snow and ice', [
				['skiing', `${MS}:downhill-skiing`, 'ski slope'],
				['cross-country-skiing', `${MDI}:ski-cross-country`, 'nordic ski'],
				['biathlon', `${MDI}:biathlon`, 'ski shoot'],
				['snowboarding', `${MS}:snowboarding`, 'snowboard'],
				['ice-skating', `${MS}:ice-skating`, 'skate rink'],
				['sledding', `${MS}:sledding`, 'sled toboggan'],
				['snowshoeing', `${MS}:snowshoeing`, 'snowshoe'],
			]],
			['Training', [
				['steps', `${MS}:steps`, 'step count shoe'],
				['interval-timer', `${MDI}:timer`, 'timer stopwatch interval'],
				['whistle', `${MDI}:whistle`, 'coach referee'],
				['trophy', `${MS}:trophy`, 'win cup'],
				['medal', `${MDI}:medal`, 'award'],
				['podium', `${MDI}:podium`, 'rank winner'],
			]],
		],
	},
	{
		id: 'everyday',
		name: 'Everyday',
		groups: [
			['Morning and care', [
				['toothbrush', `${FE}:toothbrush`, 'brush teeth'],
				['teeth', `${FE}:tooth`, 'floss dentist tooth'],
				['shower', `${FE}:shower`, 'wash'],
				['bath', `${FE}:bathtub`, 'tub soak'],
				['soap', `${FE}:soap`, 'wash hands'],
				['hand-sanitizer', `${TB}:hand-sanitizer`, 'sanitise clean hands'],
				['skincare', `${FE}:lotion-bottle`, 'lotion cream moisturise sunscreen'],
				['sponge', `${FE}:sponge`, 'scrub'],
				['shave', `${FE}:razor`, 'razor beard'],
				['hair', `${FE}:hair-pick`, 'comb brush hair'],
				['mirror', `${FE}:mirror`, 'face'],
				['nails', `${FE}:nail-polish`, 'manicure'],
				['makeup', `${FE}:lipstick`, 'lipstick'],
				['deodorant', `${TB}:spray`, 'spray perfume'],
				['toilet', `${FE}:toilet`, 'bathroom'],
				['toilet-paper', `${FE}:roll-of-paper`, 'restock'],
			]],
			['Health and sleep', [
				['pills', `${FE}:pill`, 'vitamins meds medicine supplements'],
				['bandage', `${FE}:adhesive-bandage`, 'plaster first aid'],
				['drink-water', `${FE}:cup-with-straw`, 'water bottle hydrate drink'],
				['water', `${FE}:droplet`, 'drop hydrate'],
				['glasses', `${FE}:glasses`, 'eyes contacts'],
				['bed', `${FE}:bed`, 'make bed'],
				['sleep', `${FE}:person-in-bed`, 'sleep nap bedtime'],
				['pillow', `${TB}:pillow`, 'nap'],
				['alarm', `${FE}:alarm-clock`, 'wake up clock'],
				['sunrise', `${FE}:sunrise`, 'morning wake'],
				['sunlight', `${FE}:sun`, 'sun outside daylight'],
				['night', `${FE}:crescent-moon`, 'moon bedtime evening'],
				['candle', `${FE}:candle`, 'wind down evening'],
			]],
			['Kitchen', [
				['cook', `${FE}:cooking`, 'fry egg pan'],
				['meal-prep', `${FE}:pot-of-food`, 'pot stew batch'],
				['eat', `${FE}:fork-and-knife-with-plate`, 'meal dinner lunch'],
				['breakfast', `${FE}:bowl-with-spoon`, 'cereal oats bowl'],
				['coffee', `${FE}:hot-beverage`, 'cup tea hot'],
				['tea', `${FE}:teapot`, 'pot'],
				['salad', `${FE}:green-salad`, 'vegetables greens'],
				['fruit', `${FE}:red-apple`, 'apple snack'],
				['lunchbox', `${FE}:takeout-box`, 'packed lunch takeaway'],
				['chop', `${FE}:kitchen-knife`, 'knife prep'],
				['groceries', `${FE}:shopping-cart`, 'shop supermarket'],
				['shopping', `${FE}:shopping-bags`, 'bags errands'],
			]],
			['Around the house', [
				['sweep', `${FE}:broom`, 'broom clean floor'],
				['vacuum', `${TB}:vacuum-cleaner`, 'hoover clean'],
				['mop', `${TB}:bucket-droplet`, 'mop bucket floor'],
				['laundry', `${TB}:wash-machine`, 'washing machine wash clothes'],
				['laundry-basket', `${FE}:basket`, 'hamper'],
				['iron', `${TB}:ironing-steam`, 'ironing press'],
				['socks', `${FE}:socks`, 'fold clothes'],
				['clothes', `${FE}:t-shirt`, 'outfit shirt fold'],
				['trash', `${FE}:wastebasket`, 'bin rubbish garbage'],
				['bucket', `${FE}:bucket`, 'clean'],
				['water-plants', `${FE}:potted-plant`, 'plant water garden'],
				['garden', `${FE}:seedling`, 'sprout grow'],
				['keys', `${FE}:key`, 'lock'],
				['parcel', `${FE}:package`, 'package post delivery'],
				['mail', `${FE}:envelope`, 'letter email inbox'],
				['bills', `${FE}:receipt`, 'pay receipt budget'],
				['money', `${FE}:money-bag`, 'save budget'],
				['card', `${FE}:credit-card`, 'pay'],
				['home', `${FE}:house`, 'house'],
				['car', `${FE}:automobile`, 'drive'],
				['umbrella', `${FE}:umbrella`, 'rain'],
				['door', `${FE}:door`, 'leave lock up'],
				['light', `${FE}:light-bulb`, 'lamp idea'],
			]],
			['Mind and hobbies', [
				['journal', `${FE}:writing-hand`, 'write diary'],
				['notes', `${FE}:memo`, 'memo note'],
				['notebook', `${FE}:notebook`, 'diary'],
				['read', `${FE}:open-book`, 'book reading'],
				['books', `${FE}:books`, 'library study'],
				['news', `${FE}:newspaper`, 'newspaper'],
				['plan', `${FE}:spiral-calendar`, 'calendar schedule'],
				['music', `${FE}:musical-note`, 'album listen song'],
				['podcast', `${FE}:headphone`, 'headphones listen'],
				['guitar', `${FE}:guitar`, 'practise instrument'],
				['draw', `${FE}:artist-palette`, 'art paint palette'],
				['paint', `${FE}:paintbrush`, 'brush art'],
				['sketch', `${FE}:pencil`, 'pencil draw'],
				['sew', `${FE}:sewing-needle`, 'needle thread'],
				['meditate', `${FE}:person-in-lotus-position`, 'lotus calm'],
				['walk', `${FE}:person-walking`, 'stroll'],
				['walk-dog', `${FE}:dog`, 'dog pet'],
				['feed-cat', `${FE}:cat`, 'cat pet'],
				['shoes', `${FE}:running-shoe`, 'sneaker'],
				['backpack', `${FE}:backpack`, 'pack bag'],
				['work', `${FE}:laptop`, 'laptop computer'],
				['screen-time', `${FE}:mobile-phone`, 'phone'],
				['focus', `${FE}:hourglass-done`, 'timer hourglass'],
			]],
		],
	},
]

const modules = new URL('../node_modules/', import.meta.url)
const readJson = (path) => JSON.parse(readFileSync(new URL(path, modules), 'utf8'))

/** The Iconify sets, by prefix, and the version each was read from. */
const sets = Object.fromEntries([MS, MDI, FE, TK].map((prefix) => [prefix, readJson(`@iconify-json/${prefix}/icons.json`)]))
const versions = Object.fromEntries([MS, MDI, FE, TK].map((prefix) => [prefix, readJson(`@iconify-json/${prefix}/package.json`).version]))
const tabler = readJson('@tabler/icons/tabler-nodes-outline.json')
versions[TB] = readJson('@tabler/icons/package.json').version

const ATTRIBUTES = { fill: 'fill', stroke: 'stroke', opacity: 'opacity', 'fill-rule': 'fillRule', 'clip-rule': 'clipRule' }

/**
 * An Iconify body as the catalogue's paths: every `<path>`, with what its `<g>`s gave it. Clip paths
 * are dropped after checking they cover the whole canvas, as every one in these sets does; anything
 * else the script doesn't know stops it, so a drawing is never quietly changed.
 */
function bodyPaths(body, size, source) {
	const paths = []
	const stack = [{}]
	let inDefs = 0
	for (const [, close, tag, rawAttrs, selfClose] of body.matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g)) {
		const attrs = Object.fromEntries([...rawAttrs.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v]))
		if (tag === 'defs' || tag === 'clipPath') {
			if (close) inDefs--
			else if (!selfClose) inDefs++
			continue
		}
		if (inDefs) {
			if (tag === 'path' && attrs.d !== `M0 0h${size}v${size}H0z`) throw new Error(`${source}: a clip path that doesn't cover the canvas`)
			continue
		}
		if (tag === 'g') {
			if (close) stack.pop()
			else stack.push({ ...stack.at(-1), ...attrs })
			continue
		}
		if (tag !== 'path') throw new Error(`${source}: <${tag}> isn't drawn by the catalogue`)
		const own = { ...stack.at(-1), ...attrs }
		const out = {}
		for (const [key, value] of Object.entries(own)) {
			if (key === 'd' || key === 'clip-path') continue
			if (!(key in ATTRIBUTES)) throw new Error(`${source}: unknown attribute ${key}`)
			out[ATTRIBUTES[key]] = value
		}
		// The catalogue's <svg> strokes by default (Tabler's way): a filled shape must say it has no stroke.
		if (out.fill && out.fill !== 'none' && !out.stroke) out.stroke = 'none'
		paths.push([own.d, out])
	}
	return paths
}

/** A Tabler icon's paths, as the Tabler catalogue keeps them. */
function tablerPaths(name) {
	const elements = tabler[name]
	if (!elements) throw new Error(`tabler:${name} is not in @tabler/icons`)
	return elements.map(([tag, { d, ...rest }]) => {
		if (tag !== 'path') throw new Error(`tabler:${name}: <${tag}>`)
		return Object.keys(rest).length ? [d, rest] : d
	})
}

/**
 * The square of the canvas to show: the drawing's own bounds with a margin, so a small figure fills a
 * tile as a large one does, but never closer than three quarters of the canvas, nor wider than all of it.
 * `''` for the whole 24-unit canvas, the default.
 */
function viewBox(paths, size, stroked) {
	let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
	for (const path of paths) {
		const [x0, y0, x1, y1] = svgPathBbox(typeof path === 'string' ? path : path[0])
		minX = Math.min(minX, x0)
		minY = Math.min(minY, y0)
		maxX = Math.max(maxX, x1)
		maxY = Math.max(maxY, y1)
	}
	// A stroke reaches a unit past its path; a fill ends on it.
	const margin = (stroked ? 1.5 : 1) * (size / 24)
	const side = Math.min(size, Math.max(maxX - minX, maxY - minY, size * 0.75) + 2 * margin)
	const clamp = (start) => Math.min(Math.max(start, 0), size - side)
	const round = (n) => Math.round(n * 100) / 100
	const box = [clamp((minX + maxX - side) / 2), clamp((minY + maxY - side) / 2), side, side].map(round)
	return box.join(' ') === '0 0 24 24' ? '' : box.join(' ')
}

function iconOf(source) {
	const [prefix, name] = source.split(':')
	if (prefix === TB) {
		const paths = tablerPaths(name)
		return { paths, box: viewBox(paths, 24, true) }
	}
	const set = sets[prefix]
	const icon = set.icons[name] ?? set.icons[set.aliases?.[name]?.parent]
	if (!icon) throw new Error(`${source} is not in @iconify-json/${prefix}`)
	const width = icon.width ?? set.width ?? 16
	const height = icon.height ?? set.height ?? 16
	if (width !== height) throw new Error(`${source} is not square`)
	const paths = bodyPaths(icon.body, width, source)
	return { paths, box: viewBox(paths, width, false) }
}

const seen = new Set()
const packs = PACKS.map(({ id, name, groups }) => ({
	id,
	name,
	groups: groups.map(([group, icons]) => [
		group,
		icons.map(([iconName, source, words]) => {
			if (seen.has(`${id}:${iconName}`)) throw new Error(`${id}:${iconName} twice`)
			seen.add(`${id}:${iconName}`)
			const { paths, box } = iconOf(source)
			return [iconName, words, box, paths]
		}),
	]),
}))

const out = new URL('../src/app/boardLook/iconPacks.json', import.meta.url)
writeFileSync(out, JSON.stringify({ versions, packs }))
console.log(`Wrote ${seen.size} icons in ${packs.length} packs.`)
