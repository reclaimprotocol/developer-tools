import { badRequest, Boom, isBoom } from '@hapi/boom'
import assert from 'node:assert'
import { defineTool, type RegisteredTool } from '../../mcp/server.ts'
import type { AttachState } from '../../mcp/tools/agent/attach.ts'
import {
	ALLOWED_REQUESTS_HINT,
	COOKIE_ATTACHMENT_HINT,
	USER_SCRIPT_HINT,
} from '../../provider/injection-doc.ts'
import {
	countsFor,
	matchRedactionWarnings,
} from '../../provider/match-redaction-warning.ts'
import { postPublishBrowserNotes } from '../../provider/post-publish-browser.ts'
import type { ReclaimProvider } from '../../provider/schema.ts'
import type { AllowedJsRequest } from '../../provider/to-version.ts'
import type { ReclaimOldClient } from '../client.ts'
import {
	extractVersions,
	injectedRequestDataFrom,
	type OldProviderOpts,
	providerToConfigBody,
	providerToRegisterBody,
	resolveNewVersionString,
	type SemverBump,
	type SemverTriplet,
} from '../to-register.ts'

const DEFAULT_VERSION_INFO = 'Updated from MCP browser capture'

/** Pull the new provider's id out of a register response, tolerant of the
 *  envelope (`{providerId}`, `{provider:{providerId}}`, `{id}`). */
function extractProviderId(resp: unknown): string | undefined {
	const obj = resp as
		{ providerId?: string, provider?: { providerId?: string }, id?: string }
		| null
		| undefined
	return obj?.providerId ?? obj?.provider?.providerId ?? obj?.id
}

/**
 * The old backend lets you add a version only to a provider YOU own. A
 * `providerId` for a public provider (or anyone else's) comes back as
 * 401/403/404 — the dev's likely intent is to publish their OWN version of that
 * site, which on this backend means registering a separate copy. Rethrow those
 * failures with that actionable suggestion; leave other errors (for example, a
 * 400 version collision) untouched so their real detail surfaces.
 */
function rethrowOwnershipError(err: unknown, providerId: string): never {
	const status = isBoom(err) ? err.output.statusCode : undefined
	if(status !== 401 && status !== 403 && status !== 404) {
		throw err
	}

	const base = isBoom(err) ? err.message : String(err)
	throw new Boom(
		`${base} — could not add a version to provider ${providerId}. You can ` +
		'only publish new versions on providers you own. If this is a public ' +
		"provider (or one you don't own), re-run " +
		'create_provider_version_from_capture WITHOUT `providerId` to register ' +
		"your own copy. If it IS yours, confirm you're authenticated " +
		'(reclaim_authenticate) as the account that created it.',
		{
			statusCode: status,
			data: isBoom(err) ? err.data : { status, detail: base },
		},
	)
}

/**
 * Publish a drafted provider to the OLD devtools backend. Keeps the builder
 * tool NAME (`create_provider_version_from_capture`) so the skill flow is
 * unchanged, but the behavior differs:
 *
 *   - WITHOUT `providerId` → `POST /api/providers/register`: creates a
 *     brand-new provider + version 1.0.0. Re-running creates a DUPLICATE.
 *   - WITH `providerId` → `POST /api/providers/:providerId/config`: adds a
 *     new immutable version to an existing provider (patch by default;
 *     major/minor/patch or an exact higher version when requested).
 *
 * Get a `providerId` from `get_me_providers`.
 *
 * `attachRef`, when given, is checked after a successful publish: if a
 * browser is still attached, a `_notes` entry reminds the caller to confirm
 * with the developer before closing it (see `dispose_browser`) rather than
 * closing it unprompted — the developer may still want the session for
 * further edits.
 */
export function createVersionFromCaptureTool(
	client: ReclaimOldClient,
	attachRef?: { current?: AttachState },
): RegisteredTool {
	return defineTool<{
		provider?: ReclaimProvider
		providers?: ReclaimProvider[]
		initialUrl: string
		providerId?: string
		version?: SemverTriplet
		bump?: SemverBump
		description?: string
		geoLocation?: string
		useProxy?: boolean
		providerType?: 'PRIVATE' | 'PUBLIC'
		notes?: string
		customInjection?: string
		userAgent?: { ios?: string, android?: string }
		pageTitle?: string
		allowedInjectedRequestData?: AllowedJsRequest[]
		stepsToFollow?: string
		useIncognitoWebview?: boolean
		extensionConfig?: unknown
		injectionType?: 'NONE' | 'MSWJS' | 'XHOOK' | 'CDP' | 'HAWKEYE'
		disableRequestReplay?: boolean
	}>(
		{
			name: 'create_provider_version_from_capture',
			description:
				'Publish drafted ReclaimProvider(s) to the devtools backend. Needs '
				+ 'its OWN reclaim_authenticate login — authenticate_builder does NOT '
				+ 'authorize this call. Pass the `provider` object(s) from '
				+ 'propose_provider VERBATIM, plus the `initialUrl` the user landed '
				+ 'on (the login/landing page, NOT the API url). Exactly one of '
				+ '`provider` (one request) or `providers` (a multi-request '
				+ 'provider — every entry becomes a parallel requestData entry, all '
				+ 'verified together). Captured requests must be GET/POST; OPRF '
				+ 'redactions are supported.\n\n'
				+ 'Omit `providerId` to REGISTER A NEW provider (creates it + '
				+ 'version 1.0.0 — re-running creates a DUPLICATE). Pass '
				+ '`providerId` (from get_me_providers) to add a NEW IMMUTABLE VERSION '
				+ 'to it. Omit `version` and `bump` for a patch bump, pass `bump` for '
				+ 'a major/minor/patch bump, or pass an exact higher `version` when '
				+ 'the user directs it. Never edit an existing version. You can only '
				+ 'version a provider YOU own — '
				+ 'to publish your own take on one you don\'t own, omit '
				+ '`providerId` to register your own copy.\n\n'
				+ 'THIS BACKEND ONLY EVER CREATES A NEW VERSION — there is no '
				+ 'partial-patch endpoint, and this tool carries NOTHING forward '
				+ 'from the previous version: every version replaces the WHOLE '
				+ 'providerConfig with exactly what you pass in THIS call. Any '
				+ 'field you want to survive must be re-supplied here '
				+ '(`customInjection`, `userAgent`, `pageTitle`, '
				+ '`allowedInjectedRequestData`, `stepsToFollow`, '
				+ '`useIncognitoWebview`, `extensionConfig`, `requestData`); '
				+ 'anything omitted is published blank. To change one field, read '
				+ 'the current config with get_provider_info first and pass it back '
				+ 'with your edit. `allowedInjectedRequestData`/'
				+ '`useIncognitoWebview`/`extensionConfig` apply on add-version '
				+ 'only, so a fresh register auto-follows with an add-version call '
				+ 'that applies them (and disables document replay — see '
				+ '`disableRequestReplay`).\n\n'
				+ 'Always read the response\'s `_notes`. '
				+ 'Full walkthrough: how_it_works({ topic: "publish" }).',
			inputSchema: {
				type: 'object',
				properties: {
					provider: {
						type: 'object',
						description:
							'A single `provider` object from propose_provider, verbatim. ' +
							'For multiple requests use `providers` instead.',
						properties: {
							name: { type: 'string' },
							url: { type: 'string' },
							method: { type: 'string' },
							headers: { type: 'object' },
							body: { type: 'string' },
							credentials: {
								type: 'string',
								enum: ['omit', 'same-origin', 'include'],
								description:
									'How the verification client supplies cookies/auth ' +
									'when replaying this request. Default `include`.',
							},
							urlType: {
								type: 'string',
								enum: ['REGEX', 'CONSTANT', 'TEMPLATE'],
								description:
									'How the backend treats the URL. Default derived: ' +
									'TEMPLATE when the URL has {{placeholders}}, else ' +
									'CONSTANT.',
							},
							responseMatches: { type: 'array' },
							responseRedactions: { type: 'array' },
							paramValues: { type: 'object' },
						},
						required: ['name', 'url', 'method', 'responseMatches'],
					},
					providers: {
						type: 'array',
						description:
							'Multiple proven drafts → one multi-request version (each ' +
							'becomes a parallel `requestData` entry, all verified ' +
							'together). Each item has the same shape as `provider` (if ' +
							'both are passed, they are combined). May be omitted (or ' +
							'empty) together with `provider` ONLY when adding a version ' +
							'to an EXISTING provider (`providerId` set) — publishes with ' +
							'zero `requestData` entries, for a pure customInjection/' +
							'HAWKEYE provider that relies entirely on ' +
							'`allowedInjectedRequestData` for validation instead of a ' +
							'static requestData stub. Registering a brand-new provider ' +
							'always needs at least one draft (its name comes from the ' +
							'first one).',
						items: {
							type: 'object',
							properties: {
								name: { type: 'string' },
								url: { type: 'string' },
								method: { type: 'string' },
								headers: { type: 'object' },
								body: { type: 'string' },
								credentials: {
									type: 'string',
									enum: ['omit', 'same-origin', 'include'],
								},
								urlType: {
									type: 'string',
									enum: ['REGEX', 'CONSTANT', 'TEMPLATE'],
								},
								responseMatches: { type: 'array' },
								responseRedactions: { type: 'array' },
								paramValues: { type: 'object' },
							},
							required: ['name', 'url', 'method', 'responseMatches'],
						},
					},
					initialUrl: {
						type: 'string',
						description:
							'The website URL the user landed on to trigger the request ' +
							'(maps to the provider `loginUrl`).',
					},
					providerId: {
						type: 'string',
						description:
							'Existing provider to add a new version to. Omit to register ' +
							'a brand-new provider.',
					},
					version: {
						type: 'object',
						description:
							'Exact new semver requested by the user. Existing-provider ' +
							'publishing only; it must be higher than the current highest ' +
							'version. Do not pass with `bump`.',
						properties: {
							major: { type: 'integer', minimum: 0 },
							minor: { type: 'integer', minimum: 0 },
							patch: { type: 'integer', minimum: 0 },
						},
						required: ['major', 'minor', 'patch'],
					},
					bump: {
						type: 'string',
						enum: ['major', 'minor', 'patch'],
						description:
							'Semantic increment from the highest version. Defaults to ' +
							'`patch`. Existing-provider publishing only; do not pass with ' +
							'an exact `version`.',
					},
					description: {
						type: 'string',
						description: 'Provider description (new-provider register only).',
					},
					geoLocation: {
						type: 'string',
						description:
							'Geo the verification appears to originate from. Defaults to ' +
							"'{{DYNAMIC_GEO}}' (the user's geo) when omitted.",
					},
					useProxy: {
						type: 'boolean',
						description:
							'Route portal/attestation traffic through a proxy. Defaults to ' +
							'true when omitted. Applied on register only.',
					},
					providerType: { type: 'string', enum: ['PRIVATE', 'PUBLIC'] },
					notes: {
						type: 'string',
						description:
							'Change note for the new version (update only; must be ≥10 ' +
							'chars or a default is used).',
					},
					customInjection: {
						type: 'string',
						description:
							USER_SCRIPT_HINT
							+ ' Old-devtools\' name for what the builder calls '
							+ 'webSettings.jsUserScripts. The backend rejects a few '
							+ 'deprecated injection APIs (window.payloadData, '
							+ 'window.ReclaimInjected) with a 400.',
					},
					userAgent: {
						type: 'object',
						description:
							'Per-platform user-agent override for the verification ' +
							'webview. Accepted on register too.',
						properties: {
							ios: { type: 'string' },
							android: { type: 'string' },
						},
					},
					pageTitle: {
						type: 'string',
						description: 'Page title metadata. Accepted on register too.',
					},
					allowedInjectedRequestData: {
						type: 'array',
						description:
							'Extra requests the customInjection user script is allowed to '
							+ 'fire (for example, pagination) — add-version ONLY, the '
							+ 'register '
							+ 'endpoint ignores it. Each item has the same shape as '
							+ '`provider`, plus `multiple`/`required` (default true). Set '
							+ '`body` whenever the request has one (see its own description '
							+ 'below). The builder calls the same concept '
							+ '`allowedJsRequests`. '
							+ ALLOWED_REQUESTS_HINT,
						items: {
							type: 'object',
							properties: {
								url: { type: 'string' },
								method: { type: 'string' },
								urlType: {
									type: 'string',
									enum: ['REGEX', 'CONSTANT', 'TEMPLATE'],
									description:
										'How the backend treats this URL. Default derived ' +
										'from {{placeholders}} (TEMPLATE) like a normal ' +
										'request entry.',
								},
								body: {
									type: 'string',
									description:
										'Becomes `bodySniff: { enabled: true, template: <this ' +
										'string> }` — set this whenever the request has a ' +
										'body at all (skip only for a genuinely bodyless ' +
										'request, typically GET). If the real body is FIXED ' +
										'(identical for every user/run), put that literal body ' +
										'text here verbatim. If only PART of it varies (for ' +
										'example, ' +
										'`{"request":1,"type":"user_info","id":"12345"}` where ' +
										'only `id` differs per user), template ONLY that part: ' +
										'`{"request":1,"type":"user_info",' +
										'"id":"{{REQ_BODY_USER_ID}}"}` — keep everything else ' +
										'as fixed literal text rather than templating the whole ' +
										'body. Confirmed directly against attestor-core\'s ' +
										'`hashProviderParams`: the hash embeds this string ' +
										'LITERALLY, unresolved braces and all, never the real ' +
										'substituted body, so a claim built with the SAME ' +
										'literal template (plus a witness/extracted param per ' +
										'placeholder, supplying the real value for ' +
										'verification) hashes identically regardless of what ' +
										'those real values are. This is the OPPOSITE of ' +
										'`templateParams`\' `${var}` syntax below, which ' +
										'genuinely IS substituted before hashing — do not ' +
										'confuse `{{param}}` (body, never resolved) with ' +
										'`${var}` (responseMatches/responseRedactions, resolved ' +
										'at verify time). Before publishing, hand-verify that ' +
										'substituting real sample values into this template ' +
										'reproduces the real captured request body ' +
										'byte-for-byte. Fallback if per-field templating keeps ' +
										'mismatching (more fields vary than expected, unstable ' +
										'key order, and so on) and you can\'t pin down every ' +
										'variable field: template the WHOLE body as one ' +
										'placeholder instead, `{{REQ_BODY_GRD}}` — the `GRD` ' +
										'suffix makes it a greedy match (captures everything) ' +
										'rather than the default non-greedy match, which is ' +
										'needed when nothing fixed follows the placeholder. ' +
										'This pins down nothing about body structure, so prefer ' +
										'minimal per-field placeholders whenever you can ' +
										'actually identify which fields vary.',
								},
								responseMatches: {
									type: 'array',
									description:
										'Each item: `{ value: string, type?: "contains" | ' +
										'"regex", invert?: boolean, isOptional?: boolean }`. ' +
										'`value` must literally appear (or match, if `regex`) ' +
										'somewhere in the response body for the claim to be ' +
										'accepted; it commonly embeds one or more ' +
										'`{{paramName}}` extraction placeholders (for example, ' +
										'`"name":"{{name_0}}"`) whose real value is redacted ' +
										'out and supplied separately as a witness/extracted ' +
										'param. Use `${var}` (not `{{var}}`) inside this string ' +
										'only if you also declare that name in this entry\'s ' +
										'own `templateParams` below — that\'s a DIFFERENT, ' +
										'verify-time-substituted placeholder, resolved from the ' +
										'submitted proof before hashing (unlike a body ' +
										'`{{param}}`, which never resolves — see `body` above).',
								},
								responseRedactions: {
									type: 'array',
									description:
										'Each item: `{ jsonPath?: string, xPath?: string, ' +
										'regex?: string, hash?: string }`. Identifies WHICH ' +
										'part of the response the matching `{{paramName}}` in ' +
										'`responseMatches` actually redacts or extracts — for ' +
										'example, ' +
										'`jsonPath: "$.data.items[0].name"` for a JSON response. ' +
										'Order/count should line up with `responseMatches`\' ' +
										'placeholders one-to-one for a typical claim.',
								},
								multiple: {
									type: 'boolean',
									description: 'Allow matching many requests. Default true.',
								},
								required: {
									type: 'boolean',
									description:
										'Fail validation if none match. Default true.',
								},
								templateParams: {
									type: 'array',
									items: { type: 'string' },
									description:
										'Names of `${var}` placeholders used in this ' +
										'template\'s `responseMatches`/`responseRedactions` ' +
										'that should be substituted at verify time from the ' +
										'submitted proof\'s own witness params. Omit (or ' +
										'leave empty) if the template has no such ' +
										'placeholders.',
								},
								templateParamsMode: {
									type: 'string',
									enum: ['separate', 'merge'],
									description:
										'How multiple values for `templateParams` expand ' +
										'into request specs. `separate` (default): one ' +
										'independent spec per value, each matching its own ' +
										'proof. `merge`: fold all values into ONE spec with ' +
										'one match/redaction entry per value, matching a ' +
										'single proof that bundles them all into one claim.',
								},
							},
							required: ['url', 'method'],
						},
					},
					stepsToFollow: {
						type: 'string',
						description:
							'Free-text setup/manual-verification steps shown to the ' +
							'dev/verifier. Accepted on register too.',
					},
					useIncognitoWebview: {
						type: 'boolean',
						description:
							'Run the verification webview in incognito mode. ' +
							'Add-version ONLY.',
					},
					extensionConfig: {
						description:
							'Free-form JSON passed through to the client. Add-version ' +
							'ONLY.',
					},
					injectionType: {
						type: 'string',
						enum: ['NONE', 'MSWJS', 'XHOOK', 'CDP', 'HAWKEYE'],
						description:
							'Live-interception mechanism. Omit it for the standard flow. ' +
							'Use `NONE` only to confirm a suspected interception problem; ' +
							'if that fixes the provider, keep `NONE` and use ' +
							'`window.Reclaim.requestClaim(...)`. For selection rules, call ' +
							'how_it_works({ topic: "interception" }). ' +
							COOKIE_ATTACHMENT_HINT,
					},
					disableRequestReplay: {
						type: 'boolean',
						description:
							'Whether the page\'s own document/navigation request is ' +
							'skipped (constructed locally) instead of genuinely replayed ' +
							'through the interceptor. Defaults to `true` (disabled) when ' +
							'omitted. Only meaningful for `injectionType` ' +
							'HAWKEYE/MSWJS/XHOOK — pass `false` to enable real document ' +
							'replay for those (for example, the target value is embedded ' +
							'in the page\'s own HTML). Inert when `injectionType` is ' +
							'`CDP` or ' +
							'unset.',
					},
				},
				required: ['initialUrl'],
			},
		},
		async(args) => {
			assert(
				!(args.version && args.bump),
				badRequest('Pass either `version` or `bump`, not both.'),
			)
			assert(
				args.providerId || (!args.version && !args.bump),
				badRequest(
					'`version` and `bump` require `providerId`; new-provider ' +
					'registration starts at the backend-defined version.',
				),
			)
			assert(
				args.injectionType !== 'NONE'
					|| !args.customInjection?.includes('addResponseMiddleware'),
				badRequest(
					'`injectionType: NONE` cannot deliver ' +
					'`addResponseMiddleware` traffic. Use an interceptor type, or ' +
					'keep `NONE` and replace intercepted requests with ' +
					'`window.Reclaim.requestClaim(...)`.',
				),
			)
			// `provider` / `providers` are just two spellings of the same input —
			// fold them into one array. Zero drafts is allowed ONLY when adding a
			// version to an EXISTING provider (`providerId` set): that publishes
			// with zero `requestData` entries, for a pure customInjection/HAWKEYE
			// provider whose claims are validated entirely via
			// `allowedInjectedRequestData`. Registering a brand-new provider still
			// needs at least one draft — its name comes from the first one.
			const providers = [
				...(args.provider ? [args.provider] : []),
				...(args.providers ?? []),
			]
			if(!providers.length && !args.providerId) {
				throw new Boom(
					'Pass at least one of `provider`/`providers` when registering a ' +
					'new provider (its name comes from the first draft). Omitting ' +
					'both is only allowed when adding a version to an EXISTING ' +
					'provider via `providerId`.',
					{ statusCode: 400 },
				)
			}

			const opts: OldProviderOpts = {
				initialUrl: args.initialUrl,
				description: args.description,
				geoLocation: args.geoLocation,
				useProxy: args.useProxy,
				providerType: args.providerType,
				customInjection: args.customInjection,
				userAgent: args.userAgent,
				pageTitle: args.pageTitle,
				stepsToFollow: args.stepsToFollow,
				useIncognitoWebview: args.useIncognitoWebview,
				extensionConfig: args.extensionConfig,
				// Author-settable, no forced default — the backend's own HAWKEYE
				// column default applies when omitted, same as before this field
				// existed at all.
				injectionType: args.injectionType,
				// Author-settable; defaults to disabled (see tool description).
				// Only meaningful for HAWKEYE/MSWJS/XHOOK — inert for CDP.
				disableRequestReplay: args.disableRequestReplay ?? true,
				allowedInjectedRequestData: args.allowedInjectedRequestData
					? injectedRequestDataFrom(
						args.allowedInjectedRequestData,
					)
					: undefined
			}

			// Non-blocking advisory per request — never alters or blocks the
			// publish; the author keeps full control. Attaches under `_notes`.
			const notes = matchRedactionWarnings(
				providers.map((p, i) => countsFor(`Request ${i + 1}`, p)),
			)

			// A browser session left attached after a successful publish is
			// easy to forget about — surface it so the caller asks the
			// developer before closing it (a builder-mode session is
			// quota-accounted and otherwise just sits until its TTL expires).
			const attached = attachRef?.current
			notes.push(...postPublishBrowserNotes(attached, {
				initialUrl: args.initialUrl,
				hasUserScript: !!args.customInjection?.trim(),
				hasInterceptor: args.injectionType !== 'NONE'
					&& !!args.customInjection?.trim(),
			}))

			const withNotes = (result: unknown) => {
				if(notes.length && result && typeof result === 'object') {
					return { ...result, _notes: notes }
				}

				return result
			}

			// New provider — no prior version to carry anything forward from.
			// `allowedInjectedRequestData` / `useIncognitoWebview` /
			// `extensionConfig` are accepted on the schema but the register
			// controller never reads them from the body — warn rather than
			// silently drop, so a dev doesn't think they took effect.
			if(!args.providerId) {
				if(opts.customInjection?.trim()) {
					notes.push(
						'customInjection will run in the verification client before ' +
						'every page load (before navigating to initialUrl), matching ' +
						'the builder\'s jsUserScripts.',
					)
				}

				// disableRequestReplay is honored ONLY on add-version — so every
				// register is immediately followed by an add-version call that
				// actually applies it (whatever value — default or author-set;
				// which also lands an explicit injectionType, when passed —
				// unverified whether register persists it — and any other
				// register-ignored fields the caller passed).
				const REGISTER_IGNORED_KEYS = [
					'allowedInjectedRequestData',
					'useIncognitoWebview',
					'extensionConfig',
				] as const
				const ignoredOnRegister = REGISTER_IGNORED_KEYS
					.filter((k) => args[k] !== undefined)
				if(ignoredOnRegister.length) {
					notes.push(
						`${ignoredOnRegister.join(', ')} ` +
						`${ignoredOnRegister.length > 1 ? 'are' : 'is'} ` +
						'ignored on register (no providerId) — the devtools backend only ' +
						'reads them when adding a version. They were applied by the ' +
						'automatic follow-up version this tool always creates to apply ' +
						'disableRequestReplay.',
					)
				}

				const body = providerToRegisterBody(providers, opts)
				const registered = await client.registerProvider(body)

				const newProviderId = extractProviderId(registered)
				if(newProviderId) {
					// The provider already exists as of the register call above —
					// a failure past this point must NOT reject the tool and
					// discard `registered`/`newProviderId`, or a retry without
					// `providerId` would register a DUPLICATE provider. Catch and
					// warn instead, telling the caller to resume WITH this
					// providerId.
					try {
						const versionsResp = await client.listVersions(newProviderId)
						const followVersion = resolveNewVersionString(
							extractVersions(versionsResp),
						)
						const configBody = providerToConfigBody(
							providers,
							opts,
							followVersion,
							DEFAULT_VERSION_INFO,
						)
						await client.updateProviderConfig(newProviderId, configBody)
						notes.push(
							`Created an automatic follow-up version (${followVersion}) to ` +
							`apply disableRequestReplay (${opts.disableRequestReplay})` +
							(opts.injectionType !== undefined
								? ` and set injectionType (${opts.injectionType})`
								: '') +
							' — the register endpoint ignores/may ignore those fields, so ' +
							'every fresh register gets one. It also landed any other ' +
							'register-ignored fields you passed.',
						)
					} catch(err) {
						const detail = isBoom(err) ? err.message : String(err)
						notes.push(
							`Provider ${newProviderId} WAS created, but the automatic ` +
							`follow-up version (to force-disable document replay${
								opts.injectionType !== undefined
									? ' and set injectionType'
									: ''
							}) failed: ${detail}. Do NOT retry without providerId — that ` +
							'would register a duplicate. Instead, re-run ' +
							'create_provider_version_from_capture WITH ' +
							`providerId: "${newProviderId}" to add the follow-up version.`,
						)
					}
				} else {
					notes.push(
						'Could not apply disableRequestReplay: the ' +
						'register response did not include the new providerId. Call ' +
						'this tool again WITH `providerId` to create a version that ' +
						'applies them.',
					)
				}

				return withNotes(registered)
			}

			// New version of an existing provider — resolve the requested semantic
			// increment above the highest existing version. A provider you don't own
			// (for example, a
			// public one) fails here with 401/403/404; surface the register-a-copy
			// workaround instead of a bare permission error.
			const providerId = args.providerId
			try {
				// By design this always POSTs a brand-new version and publishes
				// EXACTLY the config assembled above — nothing is read back or
				// carried forward. Any field the caller omitted is already absent
				// from `opts` and will be blank/default in the new version. To
				// preserve existing fields, the caller must have read them via
				// get_provider_info and passed them back in.
				if(args.customInjection !== undefined && opts.customInjection?.trim()) {
					notes.push(
						'customInjection will run in the verification client before ' +
						'every page load (before navigating to initialUrl), matching ' +
						'the builder\'s jsUserScripts.',
					)
				}

				notes.push(
					'A NEW version was created with only the fields passed in this ' +
					'call — nothing was carried forward from the previous version. ' +
					'If you intended to keep other fields (customInjection, ' +
					'userAgent, allowedInjectedRequestData, ...), read the prior ' +
					'version with get_provider_info and re-publish with them ' +
					'included.',
				)

				const versionsResp = await client.listVersions(providerId)
				const version = resolveNewVersionString(
					extractVersions(versionsResp),
					{ version: args.version, bump: args.bump },
				)
				const versionInfo =
					args.notes && args.notes.trim().length >= 10
						? args.notes.trim()
						: DEFAULT_VERSION_INFO
				const body = providerToConfigBody(
					providers,
					opts,
					version,
					versionInfo,
				)
				return withNotes(
					await client.updateProviderConfig(providerId, body),
				)
			} catch(err) {
				rethrowOwnershipError(err, providerId)
			}
		},
	)
}
