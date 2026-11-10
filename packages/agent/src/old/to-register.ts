import { badRequest, conflict } from '@hapi/boom'
import assert from 'node:assert'
import type { ReclaimProvider } from '../provider/schema.ts'
import type { AllowedJsRequest, DraftRequest } from '../provider/to-version.ts'
import type {
	RegisterProviderBody,
	UpdateProviderConfigBody,
} from './client.ts'

/** Default web settings, mirroring the builder openapi defaults
 *  (`ProviderWebSettings.geoLocation`, `PortalClientOptions.useProxy`). The
 *  backend accepts both: `geoLocation` lives on the providerConfig, `useProxy`
 *  is a Provider-level flag (register only). */
const DEFAULT_GEO_LOCATION = '{{DYNAMIC_GEO}}'
const DEFAULT_USE_PROXY = true

/**
 * Translate a drafted `ReclaimProvider` (from `propose_provider`) into the
 * devtools backend shapes. Deliberately a SEPARATE module from
 * `provider/to-version.ts` (the builder translator) — the two backends have
 * structurally different bodies:
 *
 *   - builder NESTS each redaction into its match's `extract`;
 *   - devtools keeps `responseMatches` and `responseRedactions` as
 *     PARALLEL arrays on each `requestData` entry.
 *
 * Devtools limit we enforce here (a clear error beats a confusing
 * server-side 400): only `GET` / `POST` methods. OPRF redactions are passed
 * through unchanged — the backend's `hash` field accepts them.
 */

export interface OldProviderOpts {
	initialUrl: string
	description?: string
	/** Defaults to `{{DYNAMIC_GEO}}` when omitted. */
	geoLocation?: string
	/** Defaults to `true` when omitted. Register only (Provider-level flag). */
	useProxy?: boolean
	providerType?: 'PRIVATE' | 'PUBLIC'
	/** Page-injection script — the devtools name for the builder's
	 *  `webSettings.jsUserScripts`. Top-level on register, nested under
	 *  `providerConfig` on config (add-version). The backend rejects a few
	 *  deprecated injection APIs (for example, `window.payloadData`) with a
	 *  400. */
	customInjection?: string
	/** Accepted at register too (unlike the four fields below, which the
	 *  backend only accepts on config/add-version). */
	userAgent?: { ios?: string, android?: string }
	/** Accepted at register too. */
	pageTitle?: string
	/** Config (add-version) ONLY — the register endpoint hardcodes this to
	 *  `[]` and ignores whatever is sent. Already old-backend-shaped: build
	 *  fresh entries with {@link injectedRequestDataFrom}; a carried-forward
	 *  value (read back from an existing version) passes through unchanged. */
	allowedInjectedRequestData?: OldInjectedRequestData[]
	/** Accepted at register too (verified from the register controller's
	 *  destructure + providerConfig write — same as `userAgent`/`pageTitle`). */
	stepsToFollow?: string
	/** Config (add-version) ONLY — the register endpoint never reads this
	 *  field from the request body. */
	useIncognitoWebview?: boolean
	/** Config (add-version) ONLY — the register endpoint never reads this
	 *  field from the request body. Free-form JSON. */
	extensionConfig?: unknown
	/** Provider-level `disableRequestReplay` (HAWKEYE document replay skip).
	 *  The publish tool always forces this `true` — there is no author-facing
	 *  way to enable document replay. Config (add-version) ONLY: the register
	 *  endpoint hardcodes it to false regardless of what's sent, so the
	 *  publish tool always follows a register up with an add-version call to
	 *  actually apply it (see `old/tools/publish.ts`). The builder backend's
	 *  inverse-named equivalent, `webSettings.clientOptions.inapp
	 *  .interceptorOptions.isDocumentRequestReplayEnabled`, is likewise always
	 *  force-disabled by `providerToCreateVersionRequest`. */
	disableRequestReplay?: boolean
	/** Interception mechanism. Omit it to use the backend's `HAWKEYE` default;
	 *  use `NONE` only when disabling interception after diagnosis.
	 *  `HAWKEYE`/`MSWJS`/`XHOOK`/`CDP` enable live interception. Old-devtools
	 *  calls this
	 *  `injectionType`; builder's equivalent is `webSettings.clientOptions
	 *  .inapp.interceptorOptions.interceptorType` (no `NONE` value there —
	 *  omitting the whole object is builder's no-interception signal
	 *  instead). See `old/client.ts`'s `RegisterProviderBody.injectionType`
	 *  doc for the register-persistence caveat. */
	injectionType?: 'NONE' | 'MSWJS' | 'XHOOK' | 'CDP' | 'HAWKEYE'
}

interface OldResponseMatch {
	value: string
	type: string
	isOptional: boolean
	order: number
}

interface OldResponseRedaction {
	xPath?: string
	jsonPath?: string
	regex?: string
	/** OPRF mode (`oprf` / `oprf-raw` / `oprf-mpc`) — the backend stores it as
	 *  a free-form string and the attestor interprets it at verification. */
	hash?: string
	order: number
}

interface OldRequestData {
	url: string
	urlType: 'REGEX' | 'CONSTANT' | 'TEMPLATE'
	method: 'GET' | 'POST'
	responseMatches: OldResponseMatch[]
	responseRedactions: OldResponseRedaction[]
	credentials: 'omit' | 'same-origin' | 'include'
	bodySniff?: { enabled: boolean, template: string }
}

/** One `allowedInjectedRequestData` entry — an `OldRequestData` plus the
 *  pagination/optionality flags the old backend stores alongside it. */
export interface OldInjectedRequestData extends OldRequestData {
	required?: boolean
	multiple?: boolean
	templateParams?: string[]
	templateParamsMode?: 'separate' | 'merge'
}

/** Build the single `requestData` entry shared by register + update. Takes
 *  the loose `DraftRequest` shape (not the full `ReclaimProvider`) so it can
 *  build BOTH the top-level `requestData` and `allowedInjectedRequestData`
 *  entries — a `ReclaimProvider` satisfies it structurally either way. */
function requestDataFromProvider(provider: DraftRequest): OldRequestData {
	const method = String(provider.method).toUpperCase()
	assert(
		method === 'GET' || method === 'POST',
		new Error(
			'Devtools supports only GET/POST requests; got ' +
			`"${provider.method}". Re-capture against a GET/POST endpoint.`,
		)
	)

	// The devtools backend has no dotted interpolation: consumer-supplied params
	// must use the `{{context_<name>}}` form here, not the builder's
	// `{{context.<name>}}`. Catch the mix-up at publish with a clear error
	// instead of a template that silently never resolves.
	const dotted = `${provider.url}\n${provider.body ?? ''}`
		.match(/\{\{context\.[A-Za-z_][A-Za-z0-9_]*\}\}/)
	assert(
		!dotted,
		new Error(
			`Devtools does not support ${dotted?.[0]} — rename ` +
			'consumer-supplied params to the {{context_<name>}} form ' +
			'for this backend.',
		)
	)

	const responseMatches: OldResponseMatch[] = (provider.responseMatches ?? [])
		.map((m, i) => ({
			value: m.value,
			type: m.type ?? 'contains',
			// The backend honors isOptional on BOTH register and add-version
			// (responseMatches pass through verbatim) — forward the author's
			// flag, default false. (`invert` has no old-backend equivalent and
			// stays dropped.)
			isOptional: m.isOptional ?? false,
			order: i,
		}))

	// Devtools wants `responseMatches` and `responseRedactions` as PARALLEL
	// arrays — same shape the builder uses, so pass them through directly. We do
	// NOT enforce any match/redaction count relationship here (and never pad —
	// empty placeholder matches break proof generation): the author keeps full
	// control. The publish tool surfaces a non-blocking warning when matches <
	// redactions (see `matchRedactionWarnings`), and the dev decides.
	const sourceRedactions = provider.responseRedactions ?? []

	const responseRedactions: OldResponseRedaction[] = sourceRedactions.map(
		(r, i) => {
			const out: OldResponseRedaction = { order: i }
			if(r.xPath !== undefined) {
				out.xPath = r.xPath
			}

			if(r.jsonPath !== undefined) {
				out.jsonPath = r.jsonPath
			}

			if(r.regex !== undefined) {
				out.regex = r.regex
			}

			// OPRF redactions are supported — pass the mode through unchanged.
			if(r.hash !== undefined) {
				out.hash = r.hash
			}

			return out
		},
	)

	const requestData: OldRequestData = {
		url: provider.url,
		// Explicit override wins; otherwise `{{param}}` placeholders → TEMPLATE
		// so the backend templates them, else a fixed CONSTANT url.
		urlType: provider.urlType
			?? (provider.url.includes('{{') ? 'TEMPLATE' : 'CONSTANT'),
		method: method,
		responseMatches,
		responseRedactions,
		// The verification client re-supplies cookies/auth at runtime; secrets
		// are never persisted (propose_provider already stripped them).
		credentials: provider.credentials ?? 'include',
	}
	if(provider.body !== undefined) {
		requestData.bodySniff = { enabled: true, template: provider.body }
	}

	// NOTE: `responseVariables` is intentionally omitted — the devtools backend
	// auto-extracts it from `{{var}}` placeholders in responseMatches. Sending
	// it ourselves would risk drifting from the server's own extraction.
	return requestData
}

/** One `requestData` entry per drafted provider. A multi-request provider
 *  becomes parallel entries that the devtools backend runs together at
 *  verification (the same way the builder version carries multiple
 *  `requests`). */
function requestDataFrom(providers: ReclaimProvider[]): OldRequestData[] {
	return providers.map(requestDataFromProvider)
}

/** Translate fresh `allowedInjectedRequestData` drafts (the author's input
 *  shape, `AllowedJsRequest[]` — same shape the builder translator uses for
 *  its own `allowedJsRequests`) into the devtools backend's shape. A
 *  carried-forward value read back from an existing version is ALREADY in
 *  this shape and should be passed straight through instead — don't run it
 *  through this a second time. */
export function injectedRequestDataFrom(
	requests: AllowedJsRequest[],
): OldInjectedRequestData[] {
	return requests.map((req) => {
		return {
			...requestDataFromProvider(req),
			required: req.required ?? true,
			multiple: req.multiple ?? true,
			templateParams: req.templateParams,
			templateParamsMode: req.templateParamsMode,
		}
	})
}

/** Body for `POST /api/providers/register` — new provider + v1.0.0. Every
 *  drafted request becomes a `requestData` entry; provider-level fields (name)
 *  come from the first draft. */
export function providerToRegisterBody(
	providers: ReclaimProvider[],
	opts: OldProviderOpts,
): RegisterProviderBody {
	const body: RegisterProviderBody = {
		name: providers[0].name,
		loginUrl: opts.initialUrl,
		providerType: opts.providerType ?? 'PRIVATE',
		// Web-settings defaults mirror the builder openapi defaults.
		geoLocation: opts.geoLocation ?? DEFAULT_GEO_LOCATION,
		useProxy: opts.useProxy ?? DEFAULT_USE_PROXY,
		requestData: requestDataFrom(providers),
	}
	if(opts.description !== undefined) {
		body.description = opts.description
	}

	if(opts.customInjection !== undefined) {
		body.customInjection = opts.customInjection
	}

	// Register also accepts these three (unlike allowedInjectedRequestData /
	// useIncognitoWebview / extensionConfig, which the register controller
	// never reads from the body at all).
	if(opts.userAgent !== undefined) {
		body.userAgent = opts.userAgent
	}

	if(opts.pageTitle !== undefined) {
		body.pageTitle = opts.pageTitle
	}

	if(opts.stepsToFollow !== undefined) {
		body.stepsToFollow = opts.stepsToFollow
	}

	if(opts.injectionType !== undefined) {
		body.injectionType = opts.injectionType
	}

	return body
}

/** Body for `POST /api/providers/:providerId/config` — adds a new version to
 *  an EXISTING provider. `version` must not already exist; `versionInfo` is
 *  required and must be ≥10 chars (enforced by the backend). */
export function providerToConfigBody(
	providers: ReclaimProvider[],
	opts: OldProviderOpts,
	version: string,
	versionInfo: string,
): UpdateProviderConfigBody {
	// `useProxy` is a Provider-level flag on the old backend, not part of a
	// version's providerConfig — so the config (new-version) path only carries
	// `geoLocation`. It defaults the same way as register.
	const providerConfig: Record<string, unknown> = {
		loginUrl: opts.initialUrl,
		geoLocation: opts.geoLocation ?? DEFAULT_GEO_LOCATION,
		requestData: requestDataFrom(providers),
	}
	if(opts.customInjection !== undefined) {
		providerConfig.customInjection = opts.customInjection
	}

	if(opts.userAgent !== undefined) {
		providerConfig.userAgent = opts.userAgent
	}

	if(opts.pageTitle !== undefined) {
		providerConfig.pageTitle = opts.pageTitle
	}

	if(opts.allowedInjectedRequestData !== undefined) {
		providerConfig.allowedInjectedRequestData = opts.allowedInjectedRequestData
	}

	if(opts.stepsToFollow !== undefined) {
		providerConfig.stepsToFollow = opts.stepsToFollow
	}

	if(opts.useIncognitoWebview !== undefined) {
		providerConfig.useIncognitoWebview = opts.useIncognitoWebview
	}

	if(opts.extensionConfig !== undefined) {
		providerConfig.extensionConfig = opts.extensionConfig
	}

	// The config (add-version) controller persists providerConfig verbatim,
	// so this lands as-is; the register controller ignores it entirely.
	if(opts.disableRequestReplay !== undefined) {
		providerConfig.disableRequestReplay = opts.disableRequestReplay
	}

	if(opts.injectionType !== undefined) {
		providerConfig.injectionType = opts.injectionType
	}

	return { providerConfig, version, versionInfo }
}

/** Minimal version triplet as the devtools backend stores it. */
export interface SemverTriplet {
	major: number
	minor: number
	patch: number
}

export type SemverBump = 'major' | 'minor' | 'patch'

/**
 * Pull `{major,minor,patch}` triplets out of a `/versions` response, tolerant
 * of the exact envelope (array, `{ providerVersions: [...] }`, `{ items }`,
 *, and so on). Each entry's `version` is the triplet.
 */
export function extractVersions(resp: unknown): SemverTriplet[] {
	const list = pickArray(resp)
	const out: SemverTriplet[] = []
	for(const item of list) {
		const v = (item as { version?: unknown }).version ?? item
		if(
			v && typeof v === 'object' &&
			typeof (v as SemverTriplet).major === 'number' &&
			typeof (v as SemverTriplet).minor === 'number' &&
			typeof (v as SemverTriplet).patch === 'number'
		) {
			const t = v as SemverTriplet
			out.push({ major: t.major, minor: t.minor, patch: t.patch })
		}
	}

	return out
}

/**
 * Next version string for an update: the highest existing triplet with its
 * patch bumped, as `"major.minor.patch"`. Falls back to `"1.0.1"` when no
 * versions are found (a provider being updated always has ≥1, but stay safe
 * rather than collide with the guaranteed 1.0.0).
 */
export function bumpPatchString(versions: SemverTriplet[]): string {
	return resolveNewVersionString(versions)
}

/** Resolve a strictly newer immutable version for old-devtools publishing. */
export function resolveNewVersionString(
	versions: SemverTriplet[],
	input: { version?: SemverTriplet, bump?: SemverBump } = {},
): string {
	assert(
		!(input.version && input.bump),
		badRequest('Pass either `version` or `bump`, not both.'),
	)
	const highest = highestVersion(versions)
	if(input.version) {
		assert(
			!highest || compareVersions(input.version, highest) > 0,
			conflict(
				`Version ${formatVersion(input.version)} must be higher than the ` +
				`current highest version ${highest ? formatVersion(highest) : 'none'}.`,
			),
		)
		return formatVersion(input.version)
	}

	if(!highest) {
		return '1.0.1'
	}

	const bump = input.bump ?? 'patch'
	switch (bump) {
		case 'major':
			return `${highest.major + 1}.0.0`
		case 'minor':
			return `${highest.major}.${highest.minor + 1}.0`
		case 'patch':
			return `${highest.major}.${highest.minor}.${highest.patch + 1}`
	}
}

function highestVersion(
	versions: SemverTriplet[],
): SemverTriplet | undefined {
	if(versions.length === 0) {
		return undefined
	}

	let hi = versions[0]
	for(const v of versions) {
		if(compareVersions(v, hi) > 0) {
			hi = v
		}
	}

	return hi
}

function compareVersions(a: SemverTriplet, b: SemverTriplet) {
	return a.major - b.major || a.minor - b.minor || a.patch - b.patch
}

function formatVersion(version: SemverTriplet) {
	return `${version.major}.${version.minor}.${version.patch}`
}

function pickArray(resp: unknown): unknown[] {
	if(Array.isArray(resp)) {
		return resp
	}

	if(resp && typeof resp === 'object') {
		const obj = resp as Record<string, unknown>
		for(const key of ['providerVersions', 'versions', 'items', 'data']) {
			if(Array.isArray(obj[key])) {
				return obj[key] as unknown[]
			}
		}
	}

	return []
}
