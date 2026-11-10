import { badRequest } from '@hapi/boom'
import type { ReclaimClient } from '@reclaimprotocol/client/api'
import assert from 'node:assert'
import { setTimeout as delay } from 'node:timers/promises'
import { LOGGER } from '../../../logger.ts'
import { defineTool, type RegisteredTool } from '../../server.ts'
import {
	type CallbackDeps,
	type CallbackEvent,
	ensureListener,
	type ListenerInfo,
	orgClient,
} from './callback-listener.ts'
import { resolveOrgSecret } from './result.ts'

const POLL_MS = 2_000
const MAX_BACKOFF_MS = 30_000
const FORWARD_TIMEOUT_MS = 10_000
const BATCH = 50
/**
 * Pages read per poll. A page is `BATCH` events, so a poll can look past up to
 * 500 pending events. That is enough to reach other sessions behind several
 * held ones, and still bounds the work of one poll.
 */
const MAX_PAGES = 10
const RECENT = 10
/** Loopback addresses, in the order tried. Dev servers often bind only one. */
const HOSTS = ['127.0.0.1', '[::1]']

interface ProxyArgs {
	port?: number
	path?: string
	stop?: boolean
	orgToken?: string
}

interface Target {
	port: number
	path: string
}

type Recent = {
	id: string
	sessionId: string
	event: string
	status: 'delivered' | 'failed'
	httpStatus?: number
	at: string
}

/** A session whose oldest pending event the app has not accepted. */
type Blocked = {
	sessionId: string
	event: string
	eventId: string
	httpStatus?: number
	attempts: number
	lastError?: string
	/** When the first attempt failed, as an ISO timestamp. */
	since: string
}

type Held = { blocked: Blocked, retryAt: number, delay: number }

type Outcome = { ok: true } | { ok: false, httpStatus?: number, error: string }

export interface ProxyDeps extends CallbackDeps {
	/** The clock, in milliseconds. Defaults to `Date.now`. */
	now?: () => number
	/** Delivers an event to the app. Defaults to global `fetch`. */
	forwardFetch?: typeof globalThis.fetch
	/** Waits between polls. Resolves early, without error, on abort. */
	sleep?: (ms: number, signal: AbortSignal) => Promise<void>
	registry?: ForwarderRegistry
}

/**
 * Polls the org's pending pull events and POSTs each envelope to a local
 * route, like `stripe listen --forward-to`. 2xx responses are acknowledged;
 * anything else (redirects included) stays pending.
 *
 * Order holds per session. When an event fails, its session is held: its later
 * events are not sent or acknowledged, and the failed event is retried with
 * exponential backoff (2 s, 4 s, ... 30 s). Other sessions keep flowing at the
 * normal poll rate. Held sessions appear in `status().blocked`, and clear when
 * the app accepts the event.
 */
class Forwarder {
	target: Target
	listener: ListenerInfo
	#client: ReclaimClient
	#deps: ProxyDeps
	#abort = new AbortController()
	#forwarded = 0
	#failed = 0
	#lastError: string | undefined
	#recent: Recent[] = []
	/** Delivered to the app but not yet acknowledged; never POSTed twice. */
	#unacked = new Set<string>()
	/** Held sessions by session id, with the time of their next attempt. */
	#held = new Map<string, Held>()
	#host = HOSTS[0]
	#running: Promise<void>

	constructor(
		client: ReclaimClient,
		listener: ListenerInfo,
		target: Target,
		deps: ProxyDeps,
	) {
		this.#client = client
		this.listener = listener
		this.target = target
		this.#deps = deps
		this.#running = this.#loop()
	}

	status() {
		return {
			forwarding: !this.#abort.signal.aborted,
			target: targetUrl(this.target, HOSTS[0]),
			listener: this.listener,
			forwarded: this.#forwarded,
			failed: this.#failed,
			...(this.#lastError ? { lastError: this.#lastError } : {}),
			recent: [...this.#recent],
			blocked: [...this.#held.values()].map((h) => h.blocked),
		}
	}

	async stop() {
		this.#abort.abort()
		await this.#running
	}

	async #loop() {
		const sleep = this.#deps.sleep || sleepFor
		const signal = this.#abort.signal
		let backoff = 0
		while(!signal.aborted) {
			let wait = POLL_MS
			try {
				const more = await this.#tick()
				backoff = 0
				wait = more ? 0 : POLL_MS
			} catch(err) {
				this.#lastError = err instanceof Error ? err.message : String(err)
				LOGGER.warn({ err }, 'callback proxy poll failed')
				backoff = nextBackoff(backoff)
				wait = backoff
			}

			if(wait && !signal.aborted) {
				await sleep(wait, signal)
			}
		}
	}

	/**
	 * Forwards one poll's worth of pending events. Returns whether to poll again
	 * at once: the page limit was hit with events still unread, and progress was
	 * made (so held sessions alone never cause a busy loop).
	 */
	async #tick() {
		const now = (this.#deps.now || Date.now)()
		// Sessions whose later events are skipped in this poll.
		const skip = new Set<string>()
		const seen = new Set<string>()
		let after: string | undefined
		let page = 0
		let full = false
		let progress = false
		do {
			const { data } = await this.#client.call('ListCallbackEvents', {
				query: { pending: true, limit: BATCH, ...(after ? { after } : {}) },
			})
			const ack: string[] = []
			for(const item of data.items) {
				if(this.#abort.signal.aborted) {
					break
				}

				seen.add(item.sessionId)
				const held = this.#held.get(item.sessionId)
				if(
					skip.has(item.sessionId)
					|| (held && held.retryAt > now && !this.#unacked.has(item.id))
				) {
					skip.add(item.sessionId)
					continue
				}

				if(this.#unacked.has(item.id)) {
					ack.push(item.id)
					continue
				}

				const outcome = await this.#forward(item)
				if(outcome.ok) {
					this.#held.delete(item.sessionId)
					ack.push(item.id)
				} else {
					// Hold the session so its later events don't overtake this one.
					this.#hold(item, outcome, now)
					skip.add(item.sessionId)
				}
			}

			if(ack.length) {
				progress = true
				for(const id of ack) {
					this.#unacked.add(id)
				}

				await this.#client.call('AcknowledgeCallbackEvents', {
					body: { ids: ack },
				})
				for(const id of ack) {
					this.#unacked.delete(id)
				}
			}

			// `next` skips what this page returned, including held events.
			after = data.next
			full = data.items.length >= BATCH
			page += 1
		} while(full && page < MAX_PAGES && !this.#abort.signal.aborted)

		if(!full) {
			// The listing was read to its end: forget sessions with nothing pending.
			for(const sessionId of this.#held.keys()) {
				if(!seen.has(sessionId)) {
					this.#held.delete(sessionId)
				}
			}
		}

		return full && progress
	}

	#hold(
		item: CallbackEvent,
		outcome: Extract<Outcome, { ok: false }>,
		now: number,
	) {
		const prev = this.#held.get(item.sessionId)
		const delay = nextBackoff(prev?.delay || 0)
		this.#held.set(item.sessionId, {
			blocked: {
				sessionId: item.sessionId,
				event: item.event,
				eventId: item.id,
				...(outcome.httpStatus === undefined
					? {}
					: { httpStatus: outcome.httpStatus }),
				attempts: (prev?.blocked.attempts || 0) + 1,
				lastError: outcome.error,
				since: prev?.blocked.since || new Date(now).toISOString(),
			},
			retryAt: now + delay,
			delay,
		})
	}

	async #forward(item: CallbackEvent): Promise<Outcome> {
		const doFetch = this.#deps.forwardFetch || globalThis.fetch
		const record = (status: Recent['status'], httpStatus?: number) => {
			this.#recent.push({
				id: item.id,
				sessionId: item.sessionId,
				event: item.event,
				status,
				...(httpStatus === undefined ? {} : { httpStatus }),
				at: new Date().toISOString(),
			})
			this.#recent.splice(0, this.#recent.length - RECENT)
		}

		const hosts = [this.#host, ...HOSTS.filter((h) => h !== this.#host)]
		for(const host of hosts) {
			try {
				const res = await doFetch(targetUrl(this.target, host), {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(item.envelope),
					signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
					// Never follow a redirect: it could re-POST the signed result
					// to a host outside this machine.
					redirect: 'manual',
				})
				this.#host = host
				if(res.ok) {
					this.#forwarded += 1
					record('delivered', res.status)
					return { ok: true }
				}

				this.#failed += 1
				const url = targetUrl(this.target, host)
				this.#lastError = res.status >= 300 && res.status < 400
					? `${url} redirected (HTTP ${res.status}). Redirects are not `
						+ 'followed; call again with the redirect target\'s `path`.'
					: `${url} returned HTTP ${res.status}`
				record('failed', res.status)
				return { ok: false, httpStatus: res.status, error: this.#lastError }
			} catch(err) {
				this.#lastError = err instanceof Error ? err.message : String(err)
			}
		}

		// No loopback address accepted the connection.
		this.#failed += 1
		record('failed')
		return { ok: false, error: this.#lastError || 'Connection failed' }
	}
}

/** The forwarders of one MCP process, one per org key. */
export class ForwarderRegistry {
	#forwarders = new Map<string, Forwarder>()

	get(secret: string) {
		return this.#forwarders.get(secret)
	}

	set(secret: string, forwarder: Forwarder) {
		this.#forwarders.set(secret, forwarder)
	}

	async stop(secret: string) {
		const forwarder = this.#forwarders.get(secret)
		this.#forwarders.delete(secret)
		await forwarder?.stop()
		return forwarder
	}

	async stopAll() {
		const all = [...this.#forwarders.values()]
		this.#forwarders.clear()
		await Promise.all(all.map((f) => f.stop()))
	}
}

const defaultRegistry = new ForwarderRegistry()

/** Stops every forwarder. Called when the MCP server shuts down. */
export function stopAllForwarders() {
	return defaultRegistry.stopAll()
}

export function proxyCallbackEventsTool(deps: ProxyDeps = {}): RegisteredTool {
	const registry = deps.registry || defaultRegistry
	return defineTool<ProxyArgs>(
		{
			name: 'proxy_callback_events',
			description:
				'Forwards the events Reclaim sends to the org\'s pull listener '
				+ 'to a local route, like `stripe listen --forward-to`. Call it '
				+ 'when the app\'s callback route runs locally. It POSTs each '
				+ 'envelope as JSON to `http://127.0.0.1:<port><path>` (loopback '
				+ 'only; also tries `[::1]`) and acknowledges 2xx responses. '
				+ 'Events of one session arrive in order. When the app rejects '
				+ 'an event, including with a redirect, that session is held and '
				+ 'retried with backoff (2 s up to 30 s) while other sessions '
				+ 'keep flowing. Creates the listener on first use, so it is not '
				+ 'read-only. One forwarder runs per org: call again to read '
				+ 'status, or with another `port` or `path` to retarget. '
				+ '`stop: true` stops forwarding only. Forwarding lasts only '
				+ 'while this MCP server runs; production needs '
				+ '`create_org_callback_subscription`. Returns `{ forwarding, '
				+ 'target, listener, forwarded, failed, lastError?, recent, '
				+ 'blocked }`. `listener.expiresAt` is the lease end, and '
				+ '`recent` lists the last events with `status` and '
				+ '`httpStatus`. `blocked` lists each held session as '
				+ '`{ sessionId, event, eventId, httpStatus?, attempts, '
				+ 'lastError?, since }`, and is `[]` when none is held. When '
				+ '`blocked` is not empty, check the app\'s response and logs '
				+ 'for that session. The app must return 2xx for a result that '
				+ 'failed verification, and 5xx only for a temporary error. '
				+ 'Fix the app, and the session resumes on the next retry.',
			inputSchema: {
				type: 'object',
				properties: {
					port: {
						type: 'integer',
						minimum: 1,
						maximum: 65535,
						description: 'The local port the app listens on.',
					},
					path: {
						type: 'string',
						pattern: '^/[^\\s#\\\\]*$',
						maxLength: 500,
						description:
							'The callback route, starting with `/`. Defaults to `/`.',
					},
					stop: {
						type: 'boolean',
						description: 'Stop forwarding. `port` is not needed.',
					},
					orgToken: {
						type: 'string',
						pattern: '^rorg_',
						maxLength: 200,
						description: 'The organization API key (`rorg_…`). Defaults to '
							+ 'the server\'s `RECLAIM_ORG_SECRET`, then the key saved by '
							+ '`issue_org_token`. Never echo it back to the user.',
					},
				},
			},
			annotations: {
				readOnlyHint: false,
				idempotentHint: true,
				openWorldHint: true,
			},
		},
		async(args) => {
			const secret = resolveOrgSecret(args.orgToken)
			if(args.stop) {
				const stopped = await registry.stop(secret)
				return {
					...(stopped?.status() || { forwarding: false }),
					_notes: 'Forwarding stopped. The listener stays alive until the '
						+ 'MCP server exits, so `read_callback_events` still works.',
				}
			}

			const existing = registry.get(secret)
			if(args.port === undefined) {
				assert(
					existing,
					badRequest('Pass `port`, the local port the app listens on.'),
				)
				existing.listener = await ensureListener(secret, deps)
				return existing.status()
			}

			const target = validateTarget(args.port, args.path ?? '/')
			if(existing) {
				existing.target = target
				existing.listener = await ensureListener(secret, deps)
				return existing.status()
			}

			const client = orgClient(secret, deps)
			const listener = await ensureListener(secret, deps)
			const forwarder = new Forwarder(client, listener, target, deps)
			registry.set(secret, forwarder)
			return forwarder.status()
		},
	)
}

/** Rejects anything that is not a path on a loopback port. */
export function validateTarget(port: number, path: string): Target {
	assert(
		Number.isInteger(port) && port >= 1 && port <= 65535,
		badRequest('`port` must be an integer from 1 to 65535.'),
	)
	assert(
		path.length <= 500 && /^\/[^\s#\\]*$/.test(path),
		badRequest(
			'`path` must start with "/" and contain no host, space, or "#".',
		),
	)
	const url = new URL(targetUrl({ port, path }, HOSTS[0]))
	assert(
		url.hostname === HOSTS[0] && url.port === String(port),
		badRequest('`path` must not change the target host.'),
	)
	return { port, path }
}

function targetUrl(target: Target, host: string) {
	return `http://${host}:${target.port}${target.path}`
}

async function sleepFor(ms: number, signal: AbortSignal) {
	await delay(ms, undefined, { signal }).catch(() => undefined)
}

function nextBackoff(current: number) {
	return Math.min(current ? current * 2 : POLL_MS, MAX_BACKOFF_MS)
}
