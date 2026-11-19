/**
 * The randomizer's sounds, made in the browser rather than played from files: a clack per flap, a
 * tick per letter tile, a thunk when the shuffle lands, and a thump for a stamp. Synthesised (a burst
 * of filtered noise, a falling tone) so there is nothing to download and each clack comes out a little
 * different from the last, which is what makes a run of them sound mechanical rather than looped.
 *
 * One audio context for the app, made on the first shuffle: browsers only let a page start sound in
 * answer to a click.
 */

const MUTED_KEY = 'lifeboard:randomizer:muted'

let muted = readMuted()
const listeners = new Set<() => void>()

function readMuted(): boolean {
	try {
		return localStorage.getItem(MUTED_KEY) === '1'
	} catch {
		return false
	}
}

export function isMuted(): boolean {
	return muted
}

export function subscribeToMuted(listener: () => void): () => void {
	listeners.add(listener)
	return () => listeners.delete(listener)
}

/** Remembered in this browser, like the app's other preferences about how it sounds and looks. */
export function setMuted(next: boolean): void {
	muted = next
	try {
		localStorage.setItem(MUTED_KEY, next ? '1' : '0')
	} catch {
		// Private-mode Safari can throw on write; forgetting it on reload is fine.
	}
	if (master && context) master.gain.setTargetAtTime(next ? 0 : 0.5, context.currentTime, 0.01)
	for (const listener of listeners) listener()
}

let context: AudioContext | null = null
let master: GainNode | null = null
let noise: AudioBuffer | null = null
let lastTick = 0

/** Call from a click: makes (or wakes) the audio context. */
export function wakeAudio(): void {
	if (!context) {
		const Ctor = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
		if (!Ctor) return
		context = new Ctor()
		master = context.createGain()
		master.gain.value = muted ? 0 : 0.5
		master.connect(context.destination)
		noise = context.createBuffer(1, Math.floor(context.sampleRate * 0.2), context.sampleRate)
		const data = noise.getChannelData(0)
		for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
	}
	if (context.state === 'suspended') void context.resume()
}

function ready(): { ac: AudioContext; out: GainNode; buffer: AudioBuffer } | null {
	if (muted || !context || !master || !noise) return null
	return { ac: context, out: master, buffer: noise }
}

function burst(freq: number, q: number, peak: number, decay: number, type: BiquadFilterType = 'bandpass'): void {
	const r = ready()
	if (!r) return
	const { ac, out, buffer } = r
	const t = ac.currentTime
	const src = ac.createBufferSource()
	const filter = ac.createBiquadFilter()
	const gain = ac.createGain()
	src.buffer = buffer
	src.playbackRate.value = 0.85 + Math.random() * 0.3
	filter.type = type
	filter.frequency.value = freq
	filter.Q.value = q
	gain.gain.setValueAtTime(0.0001, t)
	gain.gain.exponentialRampToValueAtTime(peak, t + 0.002)
	gain.gain.exponentialRampToValueAtTime(0.0001, t + decay)
	src.connect(filter)
	filter.connect(gain)
	gain.connect(out)
	src.start(t, Math.random() * 0.1)
	src.stop(t + decay + 0.02)
}

function tone(type: OscillatorType, from: number, to: number, glide: number, peak: number, decay: number): void {
	const r = ready()
	if (!r) return
	const { ac, out } = r
	const t = ac.currentTime
	const osc = ac.createOscillator()
	const gain = ac.createGain()
	osc.type = type
	osc.frequency.setValueAtTime(from, t)
	osc.frequency.exponentialRampToValueAtTime(to, t + glide)
	gain.gain.setValueAtTime(0.0001, t)
	gain.gain.exponentialRampToValueAtTime(peak, t + 0.004)
	gain.gain.exponentialRampToValueAtTime(0.0001, t + decay)
	osc.connect(gain)
	gain.connect(out)
	osc.start(t)
	osc.stop(t + decay + 0.02)
}

/** One flap falling. `intensity` 0–1: the last one, landing, is the loudest. */
export function clack(intensity: number): void {
	burst(1800 + Math.random() * 1600, 1.2, 0.9 * intensity, 0.05)
	tone('triangle', 420 + Math.random() * 140, 170, 0.03, 0.22 * intensity, 0.045)
}

/** A letter tile turning. Rate-limited: a row of them at once would otherwise be one loud buzz. */
export function tick(): void {
	const now = performance.now()
	if (now - lastTick < 16) return
	lastTick = now
	burst(4200 + Math.random() * 1800, 2, 0.22, 0.022)
}

/** The shuffle coming to rest. */
export function thunk(): void {
	tone('sine', 150, 52, 0.18, 0.7, 0.32)
	burst(520, 0.7, 0.45, 0.12, 'lowpass')
}

/** A rubber stamp coming down. */
export function stampThump(): void {
	tone('sine', 115, 48, 0.09, 0.55, 0.14)
	burst(900, 0.8, 0.5, 0.06, 'lowpass')
	burst(2600, 1.4, 0.12, 0.025)
}
