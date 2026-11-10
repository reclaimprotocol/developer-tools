import type { ReclaimClient } from '@reclaimprotocol/client/api'
import type { IOperationArgs } from '@reclaimprotocol/client/openapi'
import { randomUUID } from 'node:crypto'
import { ConfigStore } from '../config/store.ts'
import { LOGGER } from '../logger.ts'
import { VERSION } from '../pkg.ts'

type TrackArgs = IOperationArgs<'TrackAnalyticsEvents'>
type Batch = TrackArgs['body']
type Event = Batch['events'][number]
type Agent = NonNullable<NonNullable<Batch['context']>['agent']>

/** Backend mode, as the analytics API names it. */
export type TelemetryMode = 'builder' | 'devtools'

export interface TelemetryOptions {
	client: ReclaimClient
	mode: TelemetryMode
	store?: ConfigStore
	/** How long to wait after the first queued event before sending. */
	flushIntervalMs?: number
}

/** The API accepts up to 50 events per request. */
const MAX_BATCH = 50
/** Bounds memory while the backend is unreachable. Oldest events go first. */
const MAX_QUEUE = 500
/** How long `close()` waits, so a slow network can't hold up exit. */
const CLOSE_LIMIT_MS = 2000

/**
 * Sends anonymous usage events to Builder. It never throws and never blocks
 * a tool call: `track()` only queues, and a timer that doesn't keep the
 * process alive sends the queue in the background. Failed batches are
 * dropped, because usage data isn't worth retry loops in a tool server.
 *
 * Nothing is written to stdout. Stdio is the MCP transport.
 */
export class Telemetry {
	readonly mode: TelemetryMode
	readonly clientId: string
	readonly sessionId = String(Math.floor(Date.now() / 1000))

	#client: ReclaimClient
	#flushIntervalMs: number
	#queue: Event[] = []
	#timer: NodeJS.Timeout | undefined
	#agent: Agent | undefined
	/** Serializes sends so batches go out in order. */
	#sending: Promise<void> = Promise.resolve()

	constructor({
		client,
		mode,
		store = new ConfigStore(),
		flushIntervalMs = 5000,
	}: TelemetryOptions) {
		this.#client = client
		this.mode = mode
		this.#flushIntervalMs = flushIntervalMs
		this.clientId = loadClientId(store)
	}

	/** Records the MCP client (for example, Claude Code) that connected. */
	setAgent(info: { name: string, version?: string } | undefined) {
		if(info?.name) {
			this.#agent = { name: info.name, version: info.version }
		}
	}

	/** Queues an event. Synchronous, cheap, and safe to call anywhere. */
	track<N extends Event['name']>(
		name: N,
		properties: Extract<Event, { name: N }>['properties'],
	) {
		try {
			// The union is keyed by `name`; TypeScript can't correlate the two
			// generic parameters, so build the event through the union type.
			const event = {
				id: randomUUID(),
				name,
				timestamp: new Date().toISOString(),
				properties,
			} as Event
			this.#queue.push(event)
			if(this.#queue.length > MAX_QUEUE) {
				this.#queue.splice(0, this.#queue.length - MAX_QUEUE)
			}

			this.#schedule()
		} catch(err) {
			LOGGER.debug({ err }, 'telemetry: track failed')
		}
	}

	/** Sends everything queued. Never rejects. */
	flush(): Promise<void> {
		clearTimeout(this.#timer)
		this.#timer = undefined
		const events = this.#queue.splice(0)
		if(!events.length) {
			return this.#sending
		}

		this.#sending = this.#sending.then(() => this.#send(events))
		return this.#sending
	}

	/**
	 * Links this client's earlier anonymous events to the signed-in user.
	 * Needs a bearer token, so call it after sign-in.
	 */
	async identify() {
		try {
			await this.#client.call('IdentifyAnalyticsClient', {
				body: { clientId: this.clientId },
			})
		} catch(err) {
			LOGGER.debug({ err }, 'telemetry: identify failed')
		}
	}

	/**
	 * Call when sign-in finishes. Sends the `login` event first so that
	 * `identify()` can attribute it to the user.
	 */
	async signedIn() {
		this.track('login', { method: 'oauth' })
		await this.flush()
		await this.identify()
	}

	/** Sends what's left, waiting at most two seconds. */
	async close() {
		let timer: NodeJS.Timeout | undefined
		const limit = new Promise<void>((resolve) => {
			timer = setTimeout(resolve, CLOSE_LIMIT_MS)
			timer.unref()
		})
		await Promise.race([this.flush(), limit])
		clearTimeout(timer)
	}

	#schedule() {
		if(this.#timer) {
			return
		}

		// Unref'd so a pending flush never keeps the process alive.
		this.#timer = setTimeout(() => {
			this.#timer = undefined
			void this.flush()
		}, this.#flushIntervalMs)
		this.#timer.unref()
	}

	async #send(events: Event[]) {
		for(let i = 0; i < events.length; i += MAX_BATCH) {
			try {
				await this.#client.call('TrackAnalyticsEvents', {
					body: {
						clientId: this.clientId,
						source: 'mcp',
						context: {
							sessionId: this.sessionId,
							...(this.#agent ? { agent: this.#agent } : {}),
							app: { version: VERSION },
						},
						events: events.slice(i, i + MAX_BATCH),
					},
				})
			} catch(err) {
				LOGGER.debug({ err }, 'telemetry: send failed; dropping batch')
			}
		}
	}
}

/**
 * Reads the anonymous client ID from the config file, or creates it. The ID
 * is random and carries no information about the developer. The first time
 * the server creates it, it tells the developer how to opt out.
 */
function loadClientId(store: ConfigStore): string {
	try {
		const existing = store.read()?.analytics?.clientId
		if(existing) {
			return existing
		}

		const clientId = randomUUID()
		store.write({
			analytics: { clientId, createdAt: new Date().toISOString() },
		})
		LOGGER.info(
			'Reclaim records anonymous usage data to improve the product. '
			+ 'To turn it off, set RECLAIM_TELEMETRY=0 or DO_NOT_TRACK=1.',
		)
		return clientId
	} catch(err) {
		// An unwritable config file shouldn't disable the server. Use an ID
		// that lasts for this process only.
		LOGGER.debug({ err }, 'telemetry: could not persist client ID')
		return randomUUID()
	}
}
