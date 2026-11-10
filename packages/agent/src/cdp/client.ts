import CDP from 'chrome-remote-interface'
import assert from 'node:assert'
import { EventEmitter } from 'node:events'
import type {
	RequestWillBeSentLike,
	ResponseReceivedLike,
} from './capture-engine.ts'
import type { TabInfo } from './tabs.ts'
import { listTabs } from './tabs.ts'

const DIRECT_TARGET_ID = '__direct_cdp_target__'

interface CdpEventMessage {
	method: string
	params: object
	sessionId?: string
}

interface CdpTabEventMap {
	'Network.requestWillBeSent': RequestWillBeSentLike
	'Network.requestWillBeSentExtraInfo': {
		requestId: string
		headers: Record<string, string>
	}
	'Network.responseReceived': ResponseReceivedLike & {
		response: ResponseReceivedLike['response'] & { url: string }
	}
	'Network.responseReceivedExtraInfo': {
		requestId: string
		headers: Record<string, string>
	}
	'Network.loadingFinished': { requestId: string }
}

export interface CdpTabClient {
	send: (method: string, params?: object) => Promise<unknown>
	getResponseBody: (
		requestId: string,
	) => Promise<{ body: string, base64Encoded: boolean }>
	subscribe: <K extends keyof CdpTabEventMap>(
		method: K,
		listener: (params: CdpTabEventMap[K]) => void,
	) => () => void
	subscribeOnce: (method: string, listener: () => void) => () => void
	close: () => Promise<void>
}

export interface CdpHandles {
	/** Browser-level connection (target list, attach). */
	browser: CDP.Client
	/** Returns a per-target session bound to a tab. */
	attachToTab: (targetId: string) => Promise<CdpTabClient>
	/** Enumerate page targets without assuming a localhost discovery endpoint. */
	listTabs: () => Promise<TabInfo[]>
	close: () => Promise<void>
}

export async function connectCdp(port: number): Promise<CdpHandles> {
	const browser = await CDP({ port })
	const tabs = new Set<CdpTabClient>()
	return {
		browser,
		attachToTab: async(targetId) => {
			const tab = adaptCdpClient(await CDP({ port, target: targetId }))
			tabs.add(tab)
			return tab
		},
		listTabs: () => listTabs(port),
		close: async() => {
			for(const tab of tabs) {
				await tab.close().catch(() => {})
			}

			await browser.close()
		},
	}
}

/** Connect to a browser-level or page-level CDP websocket. Browser-level
 *  endpoints (including Popcorn) use flattened Target sessions; a page-level
 *  custom endpoint is exposed as one synthetic tab and used directly. */
export async function connectCdpUrl(webSocketUrl: string): Promise<CdpHandles> {
	const browser = await CDP({ target: webSocketUrl, local: true })
	let browserLevel = true
	try {
		await browser.send('Target.getTargets')
	} catch{
		browserLevel = false
	}

	const tabs = new Set<CdpTabClient>()
	const directTab = browserLevel ? undefined : adaptCdpClient(browser)
	return {
		browser,
		listTabs: async() => {
			if(!browserLevel) {
				return [{
					tabId: DIRECT_TARGET_ID, url: '', title: 'Direct CDP target',
				}]
			}

			const { targetInfos } = await browser.send('Target.getTargets')
			return targetInfos
				.filter((target) => target.type === 'page')
				.map((target) => ({
					tabId: target.targetId,
					url: target.url,
					title: target.title,
				}))
		},
		attachToTab: async(targetId) => {
			if(!browserLevel) {
				if(targetId !== DIRECT_TARGET_ID) {
					throw new Error(`Unknown direct CDP target ${targetId}`)
				}

				assert(directTab)
				return directTab
			}

			const { sessionId } = await browser.send('Target.attachToTarget', {
				targetId,
				flatten: true,
			})
			const tab = flattenedSessionClient(browser, sessionId)
			tabs.add(tab)
			return tab
		},
		close: async() => {
			for(const tab of tabs) {
				await tab.close().catch(() => {})
			}

			await browser.close()
		},
	}
}

/** Adapt a flattened browser Target session to the small tab-client surface
 *  consumed by capture and authoring. Events are filtered by session id so
 *  concurrent tabs cannot observe each other's traffic. */
function flattenedSessionClient(
	browser: CDP.Client,
	sessionId: string,
): CdpTabClient {
	const events = new EventEmitter()
	// The declaration only accepts literal protocol method names; this adapter
	// deliberately forwards the shared authoring layer's dynamic method string.
	const sender = browser.send.bind(browser) as <T>(
		method: string, params: object, sessionId?: string,
	) => Promise<T>
	const onEvent = (message: CdpEventMessage) => {
		if(message.sessionId !== sessionId) {
			return
		}

		events.emit('event', message)
		events.emit(message.method, message.params)
	}

	browser.on('event', onEvent)

	return tabClient(events, (method, params) => {
		return sender(method, params ?? {}, sessionId)
	}, (requestId) => {
		return sender<{ body: string, base64Encoded: boolean }>(
			'Network.getResponseBody', { requestId }, sessionId,
		)
	}, async() => {
		EventEmitter.prototype.removeListener.call(browser, 'event', onEvent)
		await browser.send(
			'Target.detachFromTarget', { sessionId },
		).catch(() => {})
	})
}

function adaptCdpClient(client: CDP.Client): CdpTabClient {
	const events = new EventEmitter()
	const onEvent = (message: CdpEventMessage) => {
		events.emit(message.method, message.params)
	}

	client.on('event', onEvent)

	// CRI intentionally types send against protocol literals. This adapter is
	// the single boundary where shared authoring commands arrive dynamically.
	const send = client.send.bind(client)
	return tabClient(events, send, (requestId) => {
		return client.send('Network.getResponseBody', { requestId })
	}, async() => {
		EventEmitter.prototype.removeListener.call(client, 'event', onEvent)
		await client.close()
	})
}

function tabClient(
	events: EventEmitter,
	send: CdpTabClient['send'],
	getResponseBody: CdpTabClient['getResponseBody'],
	close: CdpTabClient['close'],
): CdpTabClient {
	return {
		send,
		getResponseBody,
		subscribe(method, listener) {
			events.on(method, listener)
			return () => events.removeListener(method, listener)
		},
		subscribeOnce(method, listener) {
			events.once(method, listener)
			return () => events.removeListener(method, listener)
		},
		close,
	}
}
