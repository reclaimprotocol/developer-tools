import {
	encryptForEthPublicKey,
	generateEthKeypair,
	generateKeypair,
	jwksFromPrivateKey,
	signResultJws,
} from '@reclaimprotocol/client'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { stubFetch } from '../../client/tests/fetch.ts'
import {
	ListenerKeeper
} from '../src/mcp/tools/verification/callback-listener.ts'
import {
	ForwarderRegistry,
	proxyCallbackEventsTool,
} from '../src/mcp/tools/verification/proxy-callback-events.ts'
import {
	readCallbackEventsTool
} from '../src/mcp/tools/verification/read-callback-events.ts'

const BASE = 'https://builder.test'
const TOKEN = 'rorg_callback-events-test'
const SESSION = '0192cc40-5ac0-7d90-8f2a-9b3c4d5e6f7a'
const OTHER_SESSION = '0192cc40-5ac0-7d90-8f2a-9b3c4d5e6f7b'

type Row = {
	id: string
	subscriptionId: string
	sessionId: string
	event: string
	deliveryStatus: 'pending' | 'delivered'
	createdAt: string
	envelope: {
		sessionId: string
		event: string
		timestamp: string
		data: string
	}
}

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	})
}

function row(
	n: number,
	event = 'verification_client_opened',
	data?: string,
	sessionId = SESSION,
) {
	const timestamp = new Date().toISOString()
	return {
		id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
		subscriptionId: 'sub-1',
		sessionId,
		event,
		deliveryStatus: 'pending',
		createdAt: timestamp,
		envelope: {
			sessionId,
			event,
			timestamp,
			data: data ?? Buffer.from(
				JSON.stringify({ event, eventData: { n } }),
			).toString('base64'),
		},
	} satisfies Row
}

/** A fake Builder API: the listener, the event list, acknowledge, release. */
function fakeApi(rows: Row[] = []) {
	const state = {
		creates: 0,
		releases: 0,
		lists: 0,
		acked: [] as string[],
	}
	const { fetch, calls } = stubFetch((url, init) => {
		const { pathname, searchParams } = new URL(url)
		if(pathname === '/verifications/callback-subscriptions') {
			state.creates += 1
			return json({
				id: 'sub-1',
				orgId: 'org-1',
				deliveryMode: 'pull',
				events: [],
				createdAt: '',
				updatedAt: '',
				listenerExpiresAt: new Date(Date.now() + 90_000).toISOString(),
			}, state.creates === 1 ? 201 : 200)
		}

		if(pathname === '/verifications/callback-events/acknowledge') {
			const { ids } = JSON.parse(String(init.body)) as { ids: string[] }
			for(const r of rows) {
				if(ids.includes(r.id)) {
					r.deliveryStatus = 'delivered'
				}
			}

			state.acked.push(...ids)
			return new Response(null, { status: 204 })
		}

		if(pathname === '/verifications/callback-events') {
			state.lists += 1
			// The cursor is the 1-based position of the last event returned.
			const after = Number(searchParams.get('after') || 0)
			const limit = Number(searchParams.get('limit') || 50)
			const items = rows.filter((r, i) => (
				i >= after
				&& (searchParams.get('pending') !== 'true'
					|| r.deliveryStatus === 'pending')
			)).slice(0, limit)
			const last = items.at(-1)
			return json({
				items,
				next: String(last ? rows.indexOf(last) + 1 : after),
			})
		}

		if(pathname === '/verifications/callback-listener/release') {
			state.releases += 1
			return new Response(null, { status: 204 })
		}

		return json({ title: 'not found', status: 404 }, 404)
	})
	return { fetch, calls, state, rows }
}

/** Timers that only fire when the test says so. */
function fakeSleep() {
	/** Milliseconds elapsed; advances by `ms` each time a timer fires. */
	let clock = 0
	const waiting: { ms: number, resolve: () => void }[] = []
	const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((
		resolve,
	) => {
		if(signal.aborted) {
			return resolve()
		}

		const entry = { ms, resolve: () => {
			clock += ms
			resolve()
		} }
		waiting.push(entry)
		signal.addEventListener('abort', () => resolve(), { once: true })
	})
	/** Fire timers matching `match` until `done` holds. */
	async function pump(
		done: () => boolean,
		match = (ms: number) => ms < 30_000,
	) {
		for(let i = 0; i < 500 && !done(); i++) {
			for(const w of waiting.splice(0)) {
				if(match(w.ms)) {
					w.resolve()
				} else {
					waiting.push(w)
				}
			}

			await new Promise((r) => setImmediate(r))
		}

		assert(done(), 'condition not reached')
	}

	return { sleep, pump, waiting, now: () => clock }
}

function proxy(
	keeper: ListenerKeeper,
	api: ReturnType<typeof fakeApi>,
	timers = fakeSleep(),
) {
	const tool = proxyCallbackEventsTool({
		fetch: api.fetch,
		keeper,
		sleep: timers.sleep,
		now: timers.now,
		registry: new ForwarderRegistry(),
	})
	return { tool, timers }
}

type Item = {
	eventData?: unknown
	result?: { payload: { reclaimSessionId: string } }
	resultError?: string
}

describe('callback listener and events', () => {
	let keeper: ListenerKeeper
	let app: Server | undefined
	let received: { body: unknown, url: string }[]
	let appStatus: number
	/** Sessions whose events the app answers with HTTP 400. */
	let rejected: Set<string>
	let appLocation: string | undefined

	beforeEach(() => {
		process.env.RECLAIM_API_URL = BASE
		keeper = new ListenerKeeper()
		received = []
		appStatus = 200
		rejected = new Set()
		appLocation = undefined
	})

	afterEach(async() => {
		delete process.env.RECLAIM_API_URL
		await keeper.release().catch(() => undefined)
		await new Promise((resolve) => (app ? app.close(resolve) : resolve(null)))
		app = undefined
	})

	async function startApp() {
		app = createServer((req, res) => {
			let text = ''
			req.on('data', (c) => {
				text += c
			})
			req.on('end', () => {
				const body = JSON.parse(text) as { sessionId: string }
				received.push({ body, url: req.url || '' })
				res.statusCode = rejected.has(body.sessionId) ? 400 : appStatus
				if(appLocation) {
					res.setHeader('Location', appLocation)
				}

				res.end()
			})
		})
		await new Promise<void>((resolve) => app!.listen(0, '127.0.0.1', resolve))
		return (app.address() as AddressInfo).port
	}

	describe('read_callback_events', () => {
		it('creates the listener once, then reuses it', async() => {
			const api = fakeApi()
			const tool = readCallbackEventsTool({ fetch: api.fetch, keeper })
			const first = await tool.handler({ orgToken: TOKEN }) as {
				listener: { created: boolean, expiresAt: string }
			}
			const second = await tool.handler({ orgToken: TOKEN }) as typeof first
			assert.equal(first.listener.created, true)
			assert.equal(second.listener.created, false)
			assert.ok(first.listener.expiresAt)
		})

		it('verifies a signed result and decodes a lifecycle event', async() => {
			const vc = generateKeypair()
			const org = generateEthKeypair()
			const jws = signResultJws(vc.privateKey, {
				reclaimSessionId: SESSION,
				verification_session: {
					status: 'error',
					verification_client_id: '0192cc40-5ac0-7d90-8f2a-9b3c4d5e6f70',
				},
				results: [],
			}, BASE)
			const data = await encryptForEthPublicKey(
				org.publicJwk,
				new TextEncoder().encode(JSON.stringify(jws)),
			)
			const api = fakeApi([
				row(1),
				row(2, 'verification_error', data),
				row(3, 'verification_error', 'not-a-result'),
			])
			const base = api.fetch
			const fetch: typeof globalThis.fetch = async(input, init) => {
				const url = typeof input === 'string' ? input : String(input)
				return url.endsWith('/.well-known/jwks.json')
					? json(jwksFromPrivateKey(vc.privateKey))
					: base(input, init)
			}

			process.env.RECLAIM_DECRYPT_KEY = org.privateKeyHex
			try {
				const tool = readCallbackEventsTool({ fetch, keeper })
				const out = await tool.handler({ orgToken: TOKEN }) as {
					next: string
					items: Item[]
				}
				assert.equal(out.next, '3')
				assert.deepEqual(out.items[0].eventData, { n: 1 })
				assert.equal(
					out.items[1].result?.payload.reclaimSessionId,
					SESSION,
				)
				assert.ok(out.items[2].resultError)
			} finally {
				delete process.env.RECLAIM_DECRYPT_KEY
			}
		})
	})

	describe('heartbeat and release', () => {
		it('renews the lease every interval and releases on dispose', async() => {
			const api = fakeApi()
			const timers = fakeSleep()
			const tool = readCallbackEventsTool({
				fetch: api.fetch, keeper, sleep: timers.sleep,
			})
			await tool.handler({ orgToken: TOKEN })
			assert.equal(api.state.creates, 1)

			await timers.pump(() => api.state.creates >= 3, (ms) => ms === 30_000)
			assert.ok(api.state.creates >= 3)

			// A second tool call does not start a second heartbeat.
			await tool.handler({ orgToken: TOKEN })
			assert.equal(timers.waiting.filter((w) => w.ms === 30_000).length, 1)

			await keeper.release()
			assert.equal(api.state.releases, 1)
			const creates = api.state.creates
			await timers.pump(() => false, () => true).catch(() => undefined)
			assert.equal(api.state.creates, creates)
		})

		it('shares one heartbeat between concurrent ensure calls', async() => {
			const api = fakeApi()
			const timers = fakeSleep()
			const tool = readCallbackEventsTool({
				fetch: api.fetch, keeper, sleep: timers.sleep,
			})
			await Promise.all([
				tool.handler({ orgToken: TOKEN }),
				tool.handler({ orgToken: TOKEN }),
			])
			assert.equal(api.state.creates, 1)
			assert.equal(timers.waiting.filter((w) => w.ms === 30_000).length, 1)
		})

		it('does not renew the lease after release', async() => {
			const api = fakeApi()
			const timers = fakeSleep()
			let hang = false
			const hung: AbortSignal[] = []
			const fetch: typeof globalThis.fetch = (input, init) => {
				const signal = init?.signal
				const url = String(input)
				if(hang && url.endsWith('/callback-subscriptions') && signal) {
					hung.push(signal)
					return new Promise((_, reject) => {
						signal.addEventListener('abort', () => reject(signal.reason))
					})
				}

				return api.fetch(input, init)
			}

			const tool = readCallbackEventsTool({
				fetch, keeper, sleep: timers.sleep,
			})
			await tool.handler({ orgToken: TOKEN })
			hang = true
			await timers.pump(() => hung.length === 1, (ms) => ms === 30_000)

			await keeper.release()
			assert.equal(hung[0].aborted, true)
			assert.equal(api.state.releases, 1)
			await new Promise((r) => setImmediate(r))
			assert.equal(api.state.creates, 1)
		})

		it('survives a failed heartbeat', async() => {
			const api = fakeApi()
			const timers = fakeSleep()
			let fail = false
			let failures = 0
			const fetch: typeof globalThis.fetch = async(input, init) => {
				if(fail) {
					failures += 1
					throw new Error('network down')
				}

				return api.fetch(input, init)
			}

			const tool = readCallbackEventsTool({
				fetch, keeper, sleep: timers.sleep,
			})
			await tool.handler({ orgToken: TOKEN })
			fail = true
			await timers.pump(() => failures >= 1, (ms) => ms === 30_000)
			fail = false
			await timers.pump(() => api.state.creates >= 2, (ms) => ms === 30_000)
			assert.ok(api.state.creates >= 2)
		})
	})

	describe('proxy_callback_events', () => {
		type Status = {
			forwarding: boolean
			target: string
			forwarded: number
			failed: number
			recent: { id: string, status: string, httpStatus?: number }[]
			blocked: {
				sessionId: string
				event: string
				eventId: string
				httpStatus?: number
				attempts: number
				lastError?: string
				since: string
			}[]
		}

		it('forwards pending events to the app and acknowledges them', async() => {
			const port = await startApp()
			const api = fakeApi([row(1), row(2)])
			const { tool, timers } = proxy(keeper, api)
			const start = await tool.handler({
				port, path: '/callback', orgToken: TOKEN,
			}) as Status
			assert.equal(start.target, `http://127.0.0.1:${port}/callback`)

			await timers.pump(() => api.state.acked.length === 2)
			assert.deepEqual(received.map((r) => r.url), ['/callback', '/callback'])
			assert.deepEqual(
				received.map((r) => (r.body as { event: string }).event),
				['verification_client_opened', 'verification_client_opened'],
			)
			const status = await tool.handler({ orgToken: TOKEN }) as Status
			assert.equal(status.forwarded, 2)
			assert.deepEqual(
				status.recent.map((r) => r.status),
				['delivered', 'delivered'],
			)
			assert.equal(status.recent[0].httpStatus, 200)
			await tool.handler({ stop: true, orgToken: TOKEN })
		})

		it('keeps an event pending on HTTP 500 and retries it', async() => {
			const port = await startApp()
			appStatus = 500
			const api = fakeApi([row(1)])
			const { tool, timers } = proxy(keeper, api)
			await tool.handler({ port, orgToken: TOKEN })
			await timers.pump(() => received.length >= 2)
			await new Promise((r) => setTimeout(r, 20))
			assert.equal(api.state.acked.length, 0)
			const failing = await tool.handler({ orgToken: TOKEN }) as Status
			assert.ok(failing.failed >= 2)
			assert.equal(failing.recent.at(-1)!.httpStatus, 500)

			appStatus = 200
			await timers.pump(() => api.state.acked.length === 1)
			await tool.handler({ stop: true, orgToken: TOKEN })
		})

		it('does not follow a redirect off the machine', async() => {
			let external = 0
			const other = createServer((_, res) => {
				external += 1
				res.end()
			})
			await new Promise<void>((resolve) => {
				other.listen(0, '127.0.0.1', resolve)
			})
			try {
				const port = await startApp()
				appStatus = 307
				const otherPort = (other.address() as AddressInfo).port
				appLocation = `http://127.0.0.1:${otherPort}/x`
				const api = fakeApi([row(1)])
				const { tool, timers } = proxy(keeper, api)
				await tool.handler({ port, orgToken: TOKEN })
				await timers.pump(() => received.length >= 1)
				await new Promise((r) => setTimeout(r, 20))
				const status = await tool.handler({ orgToken: TOKEN }) as Status & {
					lastError: string
				}
				assert.equal(external, 0)
				assert.equal(api.state.acked.length, 0)
				assert.equal(status.recent.at(-1)!.status, 'failed')
				assert.equal(status.recent.at(-1)!.httpStatus, 307)
				assert.match(status.lastError, /redirected \(HTTP 307\)/)
				await tool.handler({ stop: true, orgToken: TOKEN })
			} finally {
				await new Promise((resolve) => other.close(resolve))
			}
		})

		it('holds a failing session without blocking others', async() => {
			const port = await startApp()
			rejected.add(SESSION)
			const stuck = row(1, 'verification_success')
			const later = row(2, 'verification_client_opened')
			const other = [
				row(3, 'verification_client_opened', undefined, OTHER_SESSION),
				row(4, 'verification_success', undefined, OTHER_SESSION),
			]
			const api = fakeApi([stuck, later, ...other])
			const { tool, timers } = proxy(keeper, api)
			await tool.handler({ port, orgToken: TOKEN })
			await timers.pump(() => api.state.acked.length === 2)

			// The other session got through; the held one stays pending, in order.
			assert.deepEqual(api.state.acked, [other[0].id, other[1].id])
			assert.deepEqual(
				api.rows.filter((r) => r.deliveryStatus === 'pending').map((r) => r.id),
				[stuck.id, later.id],
			)
			const held = await tool.handler({ orgToken: TOKEN }) as Status
			assert.equal(held.blocked.length, 1)
			assert.equal(held.blocked[0].sessionId, SESSION)
			assert.equal(held.blocked[0].eventId, stuck.id)
			assert.equal(held.blocked[0].event, 'verification_success')
			assert.equal(held.blocked[0].httpStatus, 400)

			// Retries back off, so attempts trail the polls.
			await timers.pump(() => api.state.lists >= 8)
			const retried = await tool.handler({ orgToken: TOKEN }) as Status
			assert.ok(retried.blocked[0].attempts > 1)
			assert.ok(retried.blocked[0].attempts < api.state.lists - 2)
			// Only the failed event was ever sent for the held session.
			assert.ok(received.every((r) => (
				(r.body as { sessionId: string }).sessionId !== SESSION
				|| (r.body as { event: string }).event === 'verification_success'
			)))

			rejected.clear()
			await timers.pump(() => api.state.acked.length === 4)
			assert.deepEqual(api.state.acked.slice(2), [stuck.id, later.id])
			const recovered = await tool.handler({ orgToken: TOKEN }) as Status
			assert.deepEqual(recovered.blocked, [])
			await tool.handler({ stop: true, orgToken: TOKEN })
		})

		it('reaches other sessions behind a full page of held events', async() => {
			const port = await startApp()
			rejected.add(SESSION)
			// Held events fill more than two pages ahead of the other session's.
			const held = Array.from({ length: 120 }, (_, i) => row(i + 1))
			const open = row(200, 'verification_success', undefined, OTHER_SESSION)
			const api = fakeApi([...held, open])
			const { tool, timers } = proxy(keeper, api)
			await tool.handler({ port, orgToken: TOKEN })
			await timers.pump(() => api.state.acked.length === 1)
			assert.deepEqual(api.state.acked, [open.id])
			await tool.handler({ stop: true, orgToken: TOKEN })
		})

		it('stops forwarding on stop but keeps the listener', async() => {
			const port = await startApp()
			const api = fakeApi([])
			const { tool, timers } = proxy(keeper, api)
			await tool.handler({ port, orgToken: TOKEN })
			const stopped = await tool.handler({
				stop: true, orgToken: TOKEN,
			}) as Status
			assert.equal(stopped.forwarding, false)

			api.rows.push(row(1))
			await timers.pump(() => false, () => true).catch(() => undefined)
			assert.equal(received.length, 0)
			assert.equal(api.state.releases, 0)
		})

		it('retargets the running forwarder', async() => {
			const port = await startApp()
			const api = fakeApi([])
			const { tool } = proxy(keeper, api)
			await tool.handler({ port, path: '/a', orgToken: TOKEN })
			const moved = await tool.handler({
				port, path: '/b', orgToken: TOKEN,
			}) as Status
			assert.equal(moved.target, `http://127.0.0.1:${port}/b`)
			await tool.handler({ stop: true, orgToken: TOKEN })
		})

		it('rejects targets that are not a loopback path', async() => {
			const api = fakeApi()
			const { tool } = proxy(keeper, api)
			for(const args of [
				{ port: 0 },
				{ port: 70000 },
				{ port: 3000.5 },
				{ port: 3000, path: 'callback' },
				{ port: 3000, path: 'http://evil.test/x' },
				{ port: 3000, path: '/a b' },
			]) {
				await assert.rejects(
					tool.handler({ ...args, orgToken: TOKEN }),
					/port|path/,
					JSON.stringify(args),
				)
			}

			assert.equal(api.state.creates, 0)
		})
	})
})
