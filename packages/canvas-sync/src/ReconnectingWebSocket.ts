import type { ClientSocket } from './SyncClient.ts'

export interface ReconnectingWebSocketOptions {
	/** The first retry's delay; each failure doubles it, up to `maxDelayMs`. */
	minDelayMs?: number
	maxDelayMs?: number
}

/**
 * A WebSocket that comes back: after a drop it retries with growing delays, and at once when the
 * browser comes back online or the tab becomes visible again.
 */
export class ReconnectingWebSocket implements ClientSocket {
	private readonly url: string
	private readonly minDelayMs: number
	private readonly maxDelayMs: number
	private handlers: Parameters<ClientSocket['start']>[0] | undefined
	private ws: WebSocket | null = null
	private isOpen = false
	private failures = 0
	private retryTimer: ReturnType<typeof setTimeout> | undefined
	private stopped = false
	private removeWindowListeners = () => {}

	constructor(url: string, { minDelayMs = 500, maxDelayMs = 10_000 }: ReconnectingWebSocketOptions = {}) {
		this.url = url
		this.minDelayMs = minDelayMs
		this.maxDelayMs = maxDelayMs
	}

	start(handlers: Parameters<ClientSocket['start']>[0]): void {
		this.handlers = handlers
		if (typeof window !== 'undefined') {
			const retryNow = () => {
				if (!this.ws) this.connect()
			}
			const onVisibilityChange = () => {
				if (document.visibilityState === 'visible') retryNow()
			}
			window.addEventListener('online', retryNow)
			document.addEventListener('visibilitychange', onVisibilityChange)
			this.removeWindowListeners = () => {
				window.removeEventListener('online', retryNow)
				document.removeEventListener('visibilitychange', onVisibilityChange)
			}
		}
		this.connect()
	}

	send(data: string): void {
		if (this.isOpen) this.ws?.send(data)
	}

	reconnect(): void {
		this.drop()
		this.connect()
	}

	stop(): void {
		this.stopped = true
		this.removeWindowListeners()
		clearTimeout(this.retryTimer)
		const ws = this.ws
		this.ws = null
		this.isOpen = false
		ws?.close()
	}

	private connect(): void {
		clearTimeout(this.retryTimer)
		this.retryTimer = undefined
		if (this.stopped) return
		const ws = new WebSocket(this.url)
		this.ws = ws
		ws.onopen = () => {
			if (this.ws !== ws) return
			this.isOpen = true
			this.failures = 0
			this.handlers?.open()
		}
		ws.onmessage = (event: MessageEvent) => {
			if (this.ws === ws) this.handlers?.message(String(event.data))
		}
		ws.onclose = () => {
			if (this.ws !== ws) return
			this.drop()
			const delay = Math.min(this.maxDelayMs, this.minDelayMs * 2 ** this.failures++)
			this.retryTimer = setTimeout(() => this.connect(), delay * (0.75 + Math.random() / 2))
		}
	}

	/** Forgets the current socket, telling the client if it was open. */
	private drop(): void {
		const ws = this.ws
		const wasOpen = this.isOpen
		this.ws = null
		this.isOpen = false
		if (ws && ws.readyState !== WebSocket.CLOSED) ws.close()
		if (wasOpen) this.handlers?.close()
	}
}
