import { badRequest, conflict } from '@hapi/boom'
import type { ReclaimClient } from '@reclaimprotocol/client/api'
import type {
	CreateProviderVersionRequest,
	ProviderVersionRef,
} from '@reclaimprotocol/client/openapi'
import assert from 'node:assert'
import type {
	DraftResponseMatch,
	HttpMethod,
	OldUrlType,
	ReclaimProvider,
	ResponseRedaction,
	WebCredentials,
} from './schema.ts'
import { DYNAMIC_GEO, normalizeGeoLocation } from './schema.ts'

/** One entry of the version's `requests[]` (a `RequestSelection`), derived
 *  from the openapi type so it can't drift from what the server accepts. */
type RequestSelection = CreateProviderVersionRequest['requests'][number]

/** The subset of a draft a request selection is built from — the only fields
 *  `providerToRequestSelection` reads. A full `ReclaimProvider` satisfies it,
 *  as does a lighter injected-request draft (no `name`/`paramValues`). */
export interface DraftRequest {
	url: string
	method: HttpMethod
	body?: string
	writeRedactionMode?: ReclaimProvider['writeRedactionMode']
	additionalClientOptions?: ReclaimProvider['additionalClientOptions']
	responseMatches?: DraftResponseMatch[]
	responseRedactions?: ResponseRedaction[]
	/** How the verification client supplies cookies/auth on replay. Default
	 *  `include` (both backends). */
	credentials?: WebCredentials
	/** Old-devtools `urlType` override. Ignored by THIS translator (the
	 *  builder backend has no urlType) — read only by the old-devtools
	 *  translator (`old/to-register.ts`). */
	urlType?: OldUrlType
}

/** A request the page's injection script is allowed to fire, plus the
 *  pagination/optionality flags of `RequestSelectionTemplate`. Reuses the
 *  shared `DraftRequest` shape — no provider `name`/`paramValues` required. */
export interface AllowedJsRequest extends DraftRequest {
	/** Allow the template to match many requests (for example, pagination).
	 *  Default true. */
	multiple?: boolean
	/** Fail validation if no request matches this template. Default true. */
	required?: boolean
	/** Names of `${var}` placeholders in this template's `responseMatches`/
	 *  `responseRedactions` that get substituted at verify time from the
	 *  submitted proof's own witness params (for example, an index list a
	 *  `Reclaim.requestClaim` call attached alongside its `{{var}}`
	 *  extractions). Omit (or leave empty) when the template has no such
	 *  placeholders — verification then matches it literally as-is. */
	templateParams?: string[]
	/** How multiple values for `templateParams` expand into request specs.
	 *  `'separate'` (default): one independent spec per value, each expected
	 *  to match its own proof. `'merge'`: all values folded into ONE spec
	 *  with one `responseMatches`/`responseRedactions` entry per value,
	 *  matching a single proof that bundles them all into one claim. */
	templateParamsMode?: 'separate' | 'merge'
}

/** Optional extras for a create-version body beyond the request list. */
export interface CreateVersionOptions {
	notes?: string
	version?: ProviderVersionRef
	/** Complete context schema for this new immutable version. When omitted,
	 *  it is derived from `{{context.<name>}}` placeholders. */
	requiredContext?: CreateProviderVersionRequest['requiredContext']
	/** JS injected before every page load (`webSettings.jsUserScripts`). */
	jsUserScripts?: string
	/** Requests the injection script may fire, as `RequestSelectionTemplate`s. */
	allowedJsRequests?: AllowedJsRequest[]
	/** Portal-only authenticated actions exposed as
	 *  `window.Reclaim.browserRequest`. */
	browserRequestActions?: NonNullable<
		CreateProviderVersionRequest['webSettings']['browserRequestActions']
	>
	/** In-app interception options, mapped to
	 *  `webSettings.clientOptions.inapp.interceptorOptions` — ONLY when this
	 *  is explicitly passed (builder's schema has no `NONE` interceptorType;
	 *  omitting `inapp` entirely IS the "no interception" signal, so omitting
	 *  this must omit `inapp`, not default it to HAWKEYE). When it IS passed,
	 *  `isDocumentRequestReplayEnabled` defaults to `false` (disabled) unless
	 *  explicitly overridden here — see `providerToCreateVersionRequest`. Only
	 *  meaningful for `HAWKEYE`/`MSWJS`; inert for `CDP`. */
	interceptorOptions?: {
		interceptorType: 'HAWKEYE' | 'MSWJS' | 'CDP'
		interceptorSettings?: string
		isDocumentRequestReplayEnabled?: boolean
	}
}

/**
 * Translate a drafted ReclaimProvider into the body for
 * POST /providers/{providerId}/versions.
 *
 * `initialUrl` is the landing page the user navigated to during
 * capture — distinct from `provider.url` which is the specific
 * API URL the attestor replays.
 *
 * Secrets are NOT persisted — the verification client re-supplies
 * them at runtime via `credentials: 'include'`.
 */
/** `{{context.<name>}}` placeholders in a request URL/body: values the
 *  CONSUMER supplies at verification time via the session `context`. Bare
 *  `{{name}}` placeholders (extraction params) are not consumer-supplied
 *  and are ignored. */
const CONTEXT_PARAM_RE = /\{\{context\.([A-Za-z_][A-Za-z0-9_]*)\}\}/g

/**
 * Derive the version's `requiredContext` JSON Schema from the
 * `{{context.<name>}}` placeholders across EVERY request's url/body (plus any
 * injected requests and the injection script) — mechanical, so a published
 * recipe can never reference a context value the Builder doesn't require.
 * Returns undefined when nothing references context (the field is optional).
 * Authors can pass a complete schema when creating the new version to refine
 * types or descriptions. Never edit a version in place after creation.
 *
 * A SECRET-named context param (see `classifyParamName`) is NOT rejected here
 * even when it's templated into the URL/geoLocation — write-redaction can
 * still hide it there, up to `secretUrlCharBudget` characters (summed across
 * every such value in that URL). Whether it actually fits is only knowable
 * once a real value exists, so that check runs at verification time
 * (`verify/run.ts`), against the consumer's actual supplied value — not here.
 */
export function deriveRequiredContext(
	providers: ReclaimProvider[],
	injection: {
		allowedJsRequests?: AllowedJsRequest[]
		jsUserScripts?: string
	} = {},
): CreateProviderVersionRequest['requiredContext'] {
	const parts: string[] = []
	for(const p of providers) {
		parts.push(p.url, p.body ?? '')
	}

	for(const p of injection.allowedJsRequests ?? []) {
		parts.push(p.url, p.body ?? '')
	}

	if(injection.jsUserScripts) {
		parts.push(injection.jsUserScripts)
	}

	const haystack = parts.join('\n')
	const names = new Set<string>()
	for(const m of haystack.matchAll(CONTEXT_PARAM_RE)) {
		names.add(m[1])
	}

	if(!names.size) {
		return undefined
	}

	const properties: Record<string, unknown> = {}
	for(const name of names) {
		properties[name] = { type: 'string' }
	}

	return { type: 'object', required: [...names], properties }
}

/**
 * Translate one drafted request into a `RequestSelection`. Shared by the
 * top-level `requests` and by `allowedJsRequests`.
 *
 * `responseMatches`/`responseRedactions` are INDEPENDENT parallel arrays,
 * isomorphic to the attestor's `ProviderParams<'http'>` (no nested fold).
 * `responseRedactions` decide which portions of the response are revealed;
 * `responseMatches` then run against the union of the revealed content. Neither
 * depends on the other's length or order, so both pass through untouched.
 * (The old-devtools translator has its own opt-in index-pairing concern; the
 * builder deliberately does not.)
 */
export function providerToRequestSelection(
	provider: DraftRequest,
): RequestSelection {
	const responseMatches = (provider.responseMatches ?? []).map((match) => ({
		type: match.type,
		value: match.value,
		isOptional: match.isOptional ?? false,
	}))
	const responseRedactions = provider.responseRedactions ?? []

	return {
		url: provider.url,
		method: provider.method,
		credentials: provider.credentials ?? 'include',
		...(provider.body ? { requestBodyTemplate: provider.body } : {}),
		...(provider.writeRedactionMode
			? { writeRedactionMode: provider.writeRedactionMode }
			: {}),
		...(provider.additionalClientOptions
			? { additionalClientOptions: provider.additionalClientOptions }
			: {}),
		...(responseMatches.length > 0 ? { responseMatches } : {}),
		...(responseRedactions.length > 0 ? { responseRedactions } : {}),
	}
}

/** First provider that declares an explicit (non-default) egress wins; if none
 *  do, fall back to DYNAMIC_GEO (resolved to the verifying user's country). */
function pickGeoLocation(providers: ReclaimProvider[]): string {
	for(const provider of providers) {
		const geo = normalizeGeoLocation(provider.geoLocation)
		if(geo) {
			return geo
		}
	}

	return DYNAMIC_GEO
}

export function providerToCreateVersionRequest(
	providers: ReclaimProvider[],
	initialUrl: string,
	opts: CreateVersionOptions = {},
): CreateProviderVersionRequest {
	const {
		notes, version, requiredContext: requestedContext, jsUserScripts,
		allowedJsRequests, browserRequestActions, interceptorOptions,
	} = opts
	const requiredContext = requestedContext ?? deriveRequiredContext(
		providers,
		{ allowedJsRequests, jsUserScripts },
	)

	// Each injected request carries its template flags (default true/true per
	// RequestSelectionTemplate) on top of the shared request shape.
	const allowedJs = (allowedJsRequests ?? []).map((req) => ({
		...providerToRequestSelection(req),
		multiple: req.multiple ?? true,
		required: req.required ?? true,
		templateParamsMode: req.templateParamsMode ?? 'separate',
		...(req.templateParams?.length
			? { templateParams: req.templateParams }
			: {}),
	}))
	const script = jsUserScripts?.trim()

	return {
		version: version ?? { major: 1, minor: 0, patch: 0 },
		initialUrl,
		// Every drafted provider becomes one request — the recipe runs them all.
		requests: providers.map(providerToRequestSelection),
		allowedJsRequests: allowedJs,
		// Mirror the builder openapi defaults explicitly — the server does not
		// apply schema defaults to request bodies.
		webSettings: {
			geoLocation: pickGeoLocation(providers),
			clientOptions: {
				portal: { useProxy: true },
				// Builder's schema has NO "NONE" interceptorType — the real
				// no-interception signal is OMITTING `inapp` entirely (it's not
				// `required` on `InAppClientOptions`). So `inapp` is only built at
				// ALL when the author explicitly opts into a real interceptorType;
				// omitting `interceptorOptions` must omit `inapp` too, or every
				// standard (non-interception) provider would incorrectly publish
				// as HAWKEYE. Within that block, `isDocumentRequestReplayEnabled`
				// defaults to disabled but is author-overridable — see
				// `CreateVersionOptions.interceptorOptions`'s doc comment.
				...(interceptorOptions
					? {
						inapp: {
							interceptorOptions: {
								interceptorType: interceptorOptions.interceptorType,
								isDocumentRequestReplayEnabled:
									interceptorOptions.isDocumentRequestReplayEnabled ?? false,
								...(interceptorOptions.interceptorSettings
									? {
										interceptorSettings:
											interceptorOptions.interceptorSettings,
									}
									: {}),
							},
						},
					}
					: {}),
			},
			// Only set when non-empty; an empty string would store a no-op script.
			...(script ? { jsUserScripts: script } : {}),
			...(browserRequestActions?.length ? { browserRequestActions } : {}),
		},
		// Derived from `{{context.<name>}}` placeholders only — a captured
		// provider's `paramValues` are extracted response parameters, not
		// consumer context, and never become requiredContext.
		...(requiredContext ? { requiredContext } : {}),
		...(notes ? { notes } : {}),
	}
}

/**
 * Fetch every current version and resolve a strictly newer immutable version.
 * The default bump is patch. Callers can request major/minor/patch or provide
 * an exact version; an exact version must be higher than every existing one.
 * A failed lookup propagates — silently resetting to 1.0.0 could collide with
 * an existing version.
 */
export async function nextVersion(
	client: ReclaimClient,
	providerId: string,
	bump: VersionBump = 'patch',
): Promise<ProviderVersionRef> {
	return bumpVersion(await listVersions(client, providerId), bump)
}

export type VersionBump = 'major' | 'minor' | 'patch'

/** Resolve either an explicit version or a requested semantic bump. */
export async function resolveNewVersion(
	client: ReclaimClient,
	providerId: string,
	input: { version?: ProviderVersionRef, bump?: VersionBump } = {},
): Promise<ProviderVersionRef> {
	assert(
		!(input.version && input.bump),
		badRequest('Pass either `version` or `bump`, not both.'),
	)
	const versions = await listVersions(client, providerId)
	if(!input.version) {
		return bumpVersion(versions, input.bump ?? 'patch')
	}

	const highest = highestVersion(versions)
	assert(
		!highest || compareVersions(input.version, highest) > 0,
		conflict(
			`Version ${formatVersion(input.version)} must be higher than the ` +
			`current highest version ${highest ? formatVersion(highest) : 'none'}.`,
		),
	)
	return input.version
}

export function bumpVersion(
	versions: ProviderVersionRef[],
	bump: VersionBump = 'patch',
): ProviderVersionRef {
	const highest = highestVersion(versions)
	if(!highest) {
		return { major: 1, minor: 0, patch: 0 }
	}

	switch (bump) {
		case 'major':
			return { major: highest.major + 1, minor: 0, patch: 0 }
		case 'minor':
			return { major: highest.major, minor: highest.minor + 1, patch: 0 }
		case 'patch':
			return {
				major: highest.major,
				minor: highest.minor,
				patch: highest.patch + 1,
			}
	}
}

async function listVersions(
	client: ReclaimClient,
	providerId: string,
): Promise<ProviderVersionRef[]> {
	const versions: ProviderVersionRef[] = []
	let cursor: string | undefined
	do {
		const { data } = await client.call('ListProviderVersions', {
			params: { providerId },
			query: { cursor },
		})
		versions.push(...data.items.map((item) => item.version))
		cursor = data.nextPageCursor
	} while(cursor)

	return versions
}

function highestVersion(
	versions: ProviderVersionRef[],
): ProviderVersionRef | undefined {
	let highest: ProviderVersionRef | undefined
	for(const version of versions) {
		if(!highest || compareVersions(version, highest) > 0) {
			highest = version
		}
	}

	return highest
}

function compareVersions(a: ProviderVersionRef, b: ProviderVersionRef) {
	return a.major - b.major || a.minor - b.minor || a.patch - b.patch
}

function formatVersion(version: ProviderVersionRef) {
	return `${version.major}.${version.minor}.${version.patch}`
}
