import { badGateway } from '@hapi/boom'
import { ReclaimClient } from '@reclaimprotocol/client/api'
import type { IOperationResponse } from '@reclaimprotocol/client/openapi'
import assert from 'node:assert'
import { setTimeout as delay } from 'node:timers/promises'
import { apiUrl } from '../../../consts.ts'
import { LOGGER } from '../../../logger.ts'
import { NAME, VERSION } from '../../../pkg.ts'

/** Runtime seams. Production passes none; tests pass a stub `fetch`. */
export interface CallbackDeps {
	fetch?: typeof globalThis.fetch
	/** Waits between heartbeats and polls. Resolves, without error, on abort. */
	sleep?: (ms: number, signal: AbortSignal) => Promise<void>
	keeper?: ListenerKeeper
}

/**
 * Events the org's pull listener subscribes to: the five session-ending
 * events (the first four carry the signed result; `session_expired` has no
 * result) plus the lifecycle milestones an app developer checks while testing.
 * High-volume diagnostics (`network_request_observed`, `provider_script_log`,
 * `user_interaction_*`) are left out, so a forwarded session sends the app at
 * most 11 requests instead of dozens.
 */
export const LISTENER_EVENTS = [
	'verification_success',
	'verification_rejected',
	'verification_error',
	'verification_cancelled',
	'session_expired',
	'session_pending',
	'verification_client_opened',
	'authenticated',
	'verification_proofs_completed',
	'verification_result_submitting',
	'verification_result_submission_failed',
] as const

export type ListenerInfo = {
	subscriptionId: string
	created: boolean
	/** When the lease lapses unless the heartbeat renews it. */
	expiresAt: string
}

export type CallbackEvent
	= IOperationResponse<'ListCallbackEvents'>['items'][number]

/**
 * A client that presents the organization's API key. With a `signal`, every
 * request aborts when it does.
 */
export function orgClient(
	secret: string,
	deps: CallbackDeps = {},
	signal?: AbortSignal,
) {
	const base = deps.fetch || globalThis.fetch
	return new ReclaimClient({
		baseUrl: apiUrl(),
		token: secret,
		fetch: signal
			? (input, init) => base(input, { ...init, signal })
			: deps.fetch,
		headers: { 'User-Agent': `${NAME}/${VERSION}` },
	})
}

/** Renewal interval. The backend lease lasts 90 seconds. */
const HEARTBEAT_MS = 30_000
/** Upper bound for releasing all listeners at shutdown. */
const RELEASE_TIMEOUT_MS = 3_000

type Entry = {
	/** Aborts with the entry, so a renew in flight cannot outlive a release. */
	client: ReclaimClient
	/** Not bound to the abort signal: it must still send the release. */
	releaseClient: ReclaimClient
	abort: AbortController
	/** The first lease; concurrent callers share it. */
	ready: Promise<ListenerInfo>
	settled: boolean
}

/**
 * Keeps each org's pull listener alive while this MCP process runs. Creating
 * the subscription is the heartbeat: it renews a lease, and the listener
 * stops receiving events when the lease lapses. {@link release} ends the
 * lease at shutdown.
 */
export class ListenerKeeper {
	#entries = new Map<string, Entry>()

	/** Creates or renews the listener and starts its heartbeat (once). */
	async ensure(secret: string, deps: CallbackDeps = {}): Promise<ListenerInfo> {
		const existing = this.#entries.get(secret)
		if(existing) {
			const wasSettled = existing.settled
			const first = await existing.ready
			// Callers that arrived during creation share its result.
			return wasSettled ? await renew(existing.client) : first
		}

		const abort = new AbortController()
		const client = orgClient(secret, deps, abort.signal)
		const sleep = deps.sleep || sleepFor
		const entry: Entry = {
			client,
			releaseClient: orgClient(secret, deps),
			abort,
			settled: false,
			ready: renew(client).then((info) => {
				entry.settled = true
				void this.#beat(entry, sleep)
				return info
			}, (err: unknown) => {
				if(this.#entries.get(secret) === entry) {
					this.#entries.delete(secret)
				}

				abort.abort()
				throw err
			}),
		}
		this.#entries.set(secret, entry)
		return await entry.ready
	}

	/** Ends every lease and stops the heartbeats, within a short timeout. */
	async release() {
		const entries = [...this.#entries.values()]
		this.#entries.clear()
		const timeout = AbortSignal.timeout(RELEASE_TIMEOUT_MS)
		await Promise.all(entries.map(async({ releaseClient, abort }) => {
			abort.abort()
			try {
				await Promise.race([
					releaseClient.call('ReleaseCallbackListener', {}),
					new Promise((_, reject) => {
						timeout.addEventListener('abort', () => reject(timeout.reason))
					}),
				])
			} catch(err) {
				LOGGER.warn({ err }, 'releasing the callback listener failed')
			}
		}))
	}

	async #beat(entry: Entry, sleep: NonNullable<CallbackDeps['sleep']>) {
		const { signal } = entry.abort
		while(!signal.aborted) {
			await sleep(HEARTBEAT_MS, signal)
			if(signal.aborted) {
				return
			}

			try {
				await renew(entry.client)
			} catch(err) {
				if(signal.aborted) {
					return
				}

				LOGGER.warn({ err }, 'callback listener heartbeat failed; retrying')
			}
		}
	}
}

const defaultKeeper = new ListenerKeeper()

/** Releases every listener this process keeps alive. Runs at MCP shutdown. */
export function releaseAllListeners() {
	return defaultKeeper.release()
}

/**
 * Create the org's pull listener and keep it alive until shutdown. An org has
 * one, so a second call returns the existing subscription (HTTP 200).
 */
export function ensureListener(secret: string, deps: CallbackDeps = {}) {
	return (deps.keeper || defaultKeeper).ensure(secret, deps)
}

async function renew(client: ReclaimClient): Promise<ListenerInfo> {
	const { data, response } = await client.call('CreateCallbackSubscription', {
		body: { deliveryMode: 'pull', events: [...LISTENER_EVENTS] },
	})
	assert(
		data.listenerExpiresAt,
		badGateway('Builder returned a pull listener without a lease.'),
	)
	return {
		subscriptionId: data.id,
		created: response.status === 201,
		expiresAt: data.listenerExpiresAt,
	}
}

export async function sleepFor(ms: number, signal: AbortSignal) {
	await delay(ms, undefined, { signal }).catch(() => undefined)
}
