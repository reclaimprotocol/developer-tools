import { Boom } from '@hapi/boom'
import { NAME, VERSION } from '../pkg.ts'

/** Default origin of the OLD devtools backend. The client appends the
 *  `/api` route prefix itself, so this is the bare origin. Override with
 *  `RECLAIM_OLD_API_URL`. */
export const DEFAULT_OLD_API_URL = 'https://devapi.reclaimprotocol.org'

/** Default origin of the OLD-devtools analytics-logs service — a SEPARATE host
 *  from the devtools API. Override with `RECLAIM_OLD_LOGS_URL`. */
export const DEFAULT_OLD_LOGS_URL = 'https://logs.reclaimprotocol.org'

/**
 * Externally-supplied caller identity. We do NOT mint these — the dev
 * provides one:
 *   - `bearer`: a Firebase ID token from the devtools dashboard. Attached
 *     as `Authorization: Bearer …`; `POST /api/users/login` provisions the
 *     user row on first use.
 *   - `eth`: an `eth:<lowercase-address>` uid for an already-provisioned
 *     eth user. Attached as the `x-eth-uid` header (no signature — the
 *     backend trusts the header for a uid that already exists).
 */
export type OldIdentity =
	| { kind: 'bearer', token: string }
	| { kind: 'eth', uid: string }

export interface RegisterProviderBody {
	name: string
	description?: string
	loginUrl: string
	geoLocation?: string
	/** Provider-level flag on the old backend (defaults false there; the
	 *  translator sends `true` to match the builder default). */
	useProxy?: boolean
	providerType?: 'PRIVATE' | 'PUBLIC'
	requestData: unknown[]
	/** Page-injection script (old-devtools name for the builder's
	 *  `webSettings.jsUserScripts`). Top-level on register; nested under
	 *  `providerConfig` on the config (add-version) body instead. */
	customInjection?: string
	/** Accepted at register too (unlike most `providerConfig` extras, which
	 *  the register controller only reads on config/add-version). */
	userAgent?: { ios?: string, android?: string }
	/** Accepted at register too. */
	pageTitle?: string
	/** Accepted at register too — verified straight from the register
	 *  controller's destructure + its `providerConfig` write, both of which
	 *  include it alongside `pageTitle`/`userAgent`. */
	stepsToFollow?: string
	/** Interception mechanism (`NONE` disables interception;
	 *  `HAWKEYE`/`MSWJS`/`XHOOK` = JS-context interception; `CDP` = browser-
	 *  level). The column defaults to `HAWKEYE` when omitted — unlike
	 *  `stepsToFollow`, and so on. above, whether the register endpoint actually
	 *  PERSISTS this field is UNVERIFIED (no source access to confirm); sent
	 *  here on the chance it does, but the publish tool always follows up
	 *  with a config (add-version) call regardless, which is confirmed to
	 *  persist it. */
	injectionType?: 'NONE' | 'MSWJS' | 'XHOOK' | 'CDP' | 'HAWKEYE'
}

export interface UpdateProviderConfigBody {
	providerConfig: Record<string, unknown>
	version: string
	versionInfo: string
}

/** Body for `POST /api/providers/:providerId` (`updateProviderMetadata`) —
 *  a genuine PARTIAL update on the PROVIDER document itself (name/
 *  description/providerType/tags/isActive), distinct from both `register`
 *  (creates the provider) and `config` (adds an immutable new version). Only
 *  the fields present get changed; everything else is left untouched. */
export interface UpdateProviderMetadataBody {
	name?: string
	description?: string
	providerType?: 'PRIVATE' | 'PUBLIC'
	tags?: string[]
	isActive?: boolean
}

export interface MyProvidersQuery {
	pageKey?: number
	pageSize?: number
	searchQuery?: string
}

/** `POST /api/applications/issue-credentials` response — a brand-new,
 *  unassociated (sandboxed) app. `appSecret` is the raw eth private key;
 *  it's returned once and never stored server-side in recoverable form. */
export interface IssuedAppCredentials {
	appId: string
	appSecret: string
}

/** `GET /api/applications/link/nonce` response — a one-time, 5-minute-TTL
 *  challenge the caller signs with the app's private key to prove ownership
 *  in `linkAppToAccount`. */
export interface LinkNonce {
	nonce: string
	expiresInSeconds: number
}

/** Log-level filter accepted by the devtools backend's session-logs route.
 *  It validates against this exact list and rejects anything else with a 400,
 *  including the comma-separated lists the log-stream service itself would
 *  accept. Each value is hierarchical at the log-stream end: `fine` means
 *  FINE+CONFIG+INFO+WARNING+SEVERE, `info` means INFO+WARNING+SEVERE, and so
 *  on. `finer`/`finest` (the PII tiers) are not reachable through this route
 *  at all. */
export type SessionLogLevel =
	| 'fine'
	| 'config'
	| 'info'
	| 'warning'
	| 'severe'
	| 'unknown'

/** Filters for {@link ReclaimOldClient.getSessionLogs}. Every one is optional
 *  and forwarded verbatim; the session id itself is the route's path param, so
 *  `providerId`/`deviceId` narrow WITHIN one session rather than searching
 *  across sessions. */
export interface SessionLogsQuery {
	deviceId?: string
	source?: string
	/** The client-side logger NAME (log-stream's `log_type` column, the SDK's
	 *  `LogEntry.type`) — not the event type. */
	logType?: string
	logLevel?: SessionLogLevel
	providerId?: string
	/** ISO-8601. Omitting BOTH bounds makes the log-stream service default to
	 *  the last 3 days. */
	startTime?: string
	endTime?: string
	/** Substring match against the log line (`LIKE %…%`). */
	logLine?: string
	/** Exact `LogEventType` name, for example `REQUEST_MATCHED`. */
	eventType?: string
	/** Capped at 1000 by the log-stream service. */
	limit?: number
	offset?: number
	includeCount?: boolean
}

/** One raw log line, in the log-stream service's snake_case ClickHouse shape,
 *  passed through unchanged by the devtools backend. `event_type` is the SDK's
 *  `LogEventType` milestone marker (`REQUEST_MATCHED`,
 *  `CLAIM_CREATION_STARTED`, `PROOF_GENERATED`, …); it is `''` on the majority
 *  of lines, which carry no event. */
export interface SessionLogRow {
	timestamp: string
	request_id: string
	session_id: string
	device_id: string
	source: string
	app_id: string
	provider_id: string
	log_type: string
	log_level: string
	log_line: string
	event_type?: string
	metadata?: string
}

/** `GET /api/logger/:sessionId`'s `data` envelope. The backend queries every
 *  region that holds the session, concatenates the pages, sorts them
 *  newest-first and re-slices to `limit`, so `data` is one page and
 *  `totalCount` is the match count across all of them. */
export interface SessionLogsPage {
	data: SessionLogRow[]
	count: number
	totalCount?: number
	/** Regions whose log-stream query failed — the page is INCOMPLETE when
	 *  this is present. */
	failedRegions?: string[]
}

interface RequestOpts {
	query?: Record<string, string | number | undefined>
	body?: unknown
	/** Attach the caller identity header. Throws if no identity is set. */
	auth?: boolean
}

/**
 * Minimal REST client for the OLD devtools Express backend (base `/api`).
 * Deliberately NOT a clone of `@reclaimprotocol/client`'s operationId
 * machinery — the old backend has no OpenAPI spec, so this exposes a few
 * hand-written typed methods for exactly the flows old mode needs:
 * authenticate, publish (register / update version), and list-own.
 *
 * Errors are thrown as `@hapi/boom` so `remapErrorAsResponse` renders them
 * identically to builder-mode `ProblemError`s.
 */
export class ReclaimOldClient {
	readonly baseUrl: string
	readonly logsBaseUrl: string
	#identity?: OldIdentity
	#fetch: typeof fetch

	constructor(opts: {
		baseUrl?: string
		logsBaseUrl?: string
		identity?: OldIdentity
		fetch?: typeof fetch
	} = {}) {
		this.baseUrl = (opts.baseUrl || DEFAULT_OLD_API_URL).replace(/\/+$/, '')
		this.logsBaseUrl = (opts.logsBaseUrl || DEFAULT_OLD_LOGS_URL)
			.replace(/\/+$/, '')
		this.#identity = opts.identity
		this.#fetch = opts.fetch ?? fetch
	}

	setIdentity(identity: OldIdentity | undefined) {
		this.#identity = identity
	}

	getIdentity(): OldIdentity | undefined {
		return this.#identity
	}

	/** Validate + provision a bearer identity. The backend creates the user
	 *  row on first login, which is what makes later authed calls work. */
	loginWithToken(): Promise<unknown> {
		return this.#request('POST', '/users/login', { auth: true })
	}

	registerProvider(body: RegisterProviderBody): Promise<unknown> {
		return this.#request('POST', '/providers/register', { body, auth: true })
	}

	updateProviderConfig(
		providerId: string,
		body: UpdateProviderConfigBody,
	): Promise<unknown> {
		return this.#request(
			'POST',
			`/providers/${encodeURIComponent(providerId)}/config`,
			{ body, auth: true },
		)
	}

	listVersions(providerId: string): Promise<unknown> {
		return this.#request(
			'GET',
			`/providers/${encodeURIComponent(providerId)}/versions`,
			{ auth: true },
		)
	}

	/** Partial update on the PROVIDER document itself — name/description/
	 *  providerType/tags/isActive, after creation. The backend 403s if you
	 *  don't own the provider (and aren't admin); other providerConfig-style
	 *  fields sent here are simply ignored (this endpoint only reads the
	 *  ones above from the body). */
	updateProviderMetadata(
		providerId: string,
		body: UpdateProviderMetadataBody,
	): Promise<unknown> {
		return this.#request(
			'POST',
			`/providers/${encodeURIComponent(providerId)}`,
			{ body, auth: true },
		)
	}

	/** Analytics logs for a verification session, from the logs service (a
	 *  DIFFERENT host than the devtools API — hence its own fetch, not
	 *  `#request`). Attaches the caller identity when one is set; queried
	 *  anonymously otherwise. */
	async getSessionAnalyticsLogs(sessionId: string): Promise<unknown> {
		const url = `${this.logsBaseUrl}/api/analytics-logs/session/`
			+ encodeURIComponent(sessionId)
		const headers: Record<string, string> = {
			Accept: 'application/json',
			'User-Agent': `${NAME}/${VERSION}`,
		}
		if(this.#identity) {
			headers[this.#authHeaderName()] = this.#authHeaderValue()
		}

		const res = await this.#fetch(url, { method: 'GET', headers })
		const json = await this.#parseBody(res)
		if(!res.ok) {
			throw this.#asBoom(res, json)
		}

		return json
	}

	/**
	 * Raw log LINES for a verification session — the SDK's own diagnostic
	 * logging, the thing the dashboard's session "logs" tab renders, and a
	 * strictly richer signal than `getSessionAnalyticsLogs`'s milestone events.
	 *
	 * This is the devtools backend (`GET /api/logger/:sessionId`), NOT the
	 * analytics-logs host — hence `#request`, and hence the same identity and
	 * ownership rules as every other authed call here: the session's app must
	 * be one you created (admins excepted), or the route 404s.
	 *
	 * The backend fans the query out to the per-region log-stream services,
	 * which read the ClickHouse `logs` table. Two defaults applied down there
	 * bite hard if you don't override them:
	 *   - no `startTime`/`endTime` → only the last 3 days are searched;
	 *   - no `logLevel` → INFO and above only, so every FINE/CONFIG line is
	 *     invisible.
	 * Entries are dropped entirely after 30 days (table TTL).
	 */
	async getSessionLogs(
		sessionId: string,
		query: SessionLogsQuery = {},
	): Promise<SessionLogsPage> {
		const res = await this.#request(
			'GET',
			`/logger/${encodeURIComponent(sessionId)}`,
			{
				auth: true,
				query: {
					deviceId: query.deviceId,
					source: query.source,
					logType: query.logType,
					logLevel: query.logLevel,
					providerId: query.providerId,
					startTime: query.startTime,
					endTime: query.endTime,
					logLine: query.logLine,
					eventType: query.eventType,
					limit: query.limit,
					offset: query.offset,
					includeCount: query.includeCount === undefined
						? undefined
						: String(query.includeCount),
				},
			},
		)
		const page = (res as { data?: Partial<SessionLogsPage> }).data
		return {
			data: page?.data ?? [],
			count: page?.count ?? page?.data?.length ?? 0,
			totalCount: page?.totalCount,
			failedRegions: page?.failedRegions,
		}
	}

	/** Mint a brand-new, unassociated (sandboxed) app — no auth required. Link
	 *  it to an account afterwards with `getLinkNonce` + `linkAppToAccount`, or
	 *  use it as-is within the sandbox session limit. */
	async issueCredentials(): Promise<IssuedAppCredentials> {
		const res = await this.#request('POST', '/applications/issue-credentials')
		return (res as { data: IssuedAppCredentials }).data
	}

	/** One-time, 5-minute challenge for `linkAppToAccount`. Requires auth —
	 *  the nonce is scoped to the authenticated user's uid. */
	async getLinkNonce(): Promise<LinkNonce> {
		const res = await this.#request('GET', '/applications/link/nonce', {
			auth: true,
		})
		return (res as { data: LinkNonce }).data
	}

	/** Link an unassociated (`issueCredentials`-minted) app to the
	 *  authenticated account. `signature` must be an EIP-191 signature, made
	 *  with the app's private key, over the exact string
	 *  `` `Link ${appId} to account ${userId} | nonce: ${nonce}` `` — see
	 *  `buildLinkMessage` in the backend's `application.controller.ts`. Fails
	 *  with `APP_ALREADY_LINKED` (400) if the app already belongs to someone. */
	linkAppToAccount(
		appId: string,
		signature: string,
		nonce: string,
	): Promise<unknown> {
		return this.#request('POST', '/applications/link', {
			body: { appId, signature, nonce },
			auth: true,
		})
	}

	/** Public, unauthenticated app status — `isLinked`, sandbox/quota info.
	 *  Works for any appId, owned or not. */
	async getApplicationStatus(appId: string): Promise<unknown> {
		const res = await this.#request(
			'GET',
			`/applications/status/${encodeURIComponent(appId)}`,
		)
		return (res as { data: unknown }).data
	}

	getMyProviders(query: MyProvidersQuery = {}): Promise<unknown> {
		// Every one of these query params is REQUIRED by the backend
		// validator (missing/invalid → 400), so default them all here.
		return this.#request('GET', '/providers/user/paginated', {
			auth: true,
			query: {
				pageKey: query.pageKey ?? 0,
				pageSize: query.pageSize ?? 20,
				searchQuery: query.searchQuery ?? '',
				sortByCreatedLatest: 'true',
				providerType: 'ALL',
				providerStatus: 'ALL',
				providerVisibility: 'ALL',
			},
		})
	}

	async #request(
		method: string,
		path: string,
		opts: RequestOpts = {},
	): Promise<unknown> {
		let url = `${this.baseUrl}/api${path}`
		if(opts.query) {
			const search = new URLSearchParams()
			for(const [k, v] of Object.entries(opts.query)) {
				if(v === undefined) {
					continue
				}

				search.append(k, String(v))
			}

			const qs = search.toString()
			if(qs) {
				url += `?${qs}`
			}
		}

		const headers: Record<string, string> = {
			Accept: 'application/json',
			'User-Agent': `${NAME}/${VERSION}`,
		}
		if(opts.auth) {
			headers[this.#authHeaderName()] = this.#authHeaderValue()
		}

		const init: RequestInit = { method, headers }
		if(method !== 'GET' && method !== 'HEAD') {
			init.body = JSON.stringify(opts.body ?? {})
			headers['Content-Type'] = 'application/json'
		}

		const res = await this.#fetch(url, init)
		const json = await this.#parseBody(res)

		// Old API convention: { message, ...data, isSuccess }. Treat a non-2xx
		// OR an explicit isSuccess:false as an error so a 200-with-failure
		// body never slips through as success.
		const failed =
			!res.ok ||
			(json !== undefined &&
				typeof json === 'object' &&
				(json as { isSuccess?: unknown }).isSuccess === false)
		if(failed) {
			throw this.#asBoom(res, json)
		}

		return json
	}

	#authHeaderName(): string {
		const id = this.#requireIdentity()
		return id.kind === 'bearer' ? 'Authorization' : 'x-eth-uid'
	}

	#authHeaderValue(): string {
		const id = this.#requireIdentity()
		return id.kind === 'bearer' ? `Bearer ${id.token}` : id.uid
	}

	#requireIdentity(): OldIdentity {
		if(!this.#identity) {
			throw new Boom(
				'Not authenticated against old devtools. Call reclaim_authenticate ' +
					'with a dashboard token (or eth uid) first.',
				{ statusCode: 401, data: { status: 401, detail: 'no identity set' } },
			)
		}

		return this.#identity
	}

	async #parseBody(res: Response): Promise<unknown> {
		if(res.status === 204 || res.headers.get('content-length') === '0') {
			return undefined
		}

		try {
			return await res.json()
		} catch{
			return undefined
		}
	}

	#asBoom(res: Response, json: unknown): Boom {
		const rawMessage =
			(json && typeof json === 'object' &&
				typeof (json as { message?: unknown }).message === 'string'
				? (json as { message: string }).message
				: undefined) || res.statusText || 'Old devtools request failed'
		// An identity ALREADY SET (as opposed to `#requireIdentity`'s "never
		// authenticated" case, which never reaches the backend) plus either a
		// 401/403 OR a message that itself names token verification means the
		// backend rejected a token we had — that is, it's stale/invalid, not merely
		// absent. The message check matters because this backend does NOT
		// reliably use 401/403 for it — confirmed live: an actually-expired
		// Firebase token surfaced as "Error while verifying token" with a
		// status this narrow check (401/403-only) missed entirely, silently
		// skipping the enrichment. The backend's own message gives no hint of
		// the fix, and nothing else distinguishes this from Builder auth, so
		// append repo-side guidance rather than replacing the raw detail.
		const staleAuth = !!this.#identity && (
			res.status === 401 || res.status === 403 ||
			/verify.{0,20}token|token.{0,20}verif/i.test(rawMessage)
		)
		const message = staleAuth
			? `${rawMessage} — your old-devtools login looks stale or invalid `
				+ '(this is separate from Builder auth). Re-run reclaim_authenticate '
				+ 'to refresh it, then retry.'
			: rawMessage
		// Shape `data` like a ProblemDetails so remapErrorAsResponse can render
		// `${message}: ${data.detail}` and expose the raw body as structured.
		return new Boom(message, {
			statusCode: res.ok ? 502 : res.status,
			data: {
				status: res.status,
				title: message,
				detail: message,
				body: json,
			},
		})
	}
}
