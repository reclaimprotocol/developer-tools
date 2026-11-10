import { badRequest } from '@hapi/boom'
import type { ReclaimClient } from '@reclaimprotocol/client/api'
import type {
	CreateProviderVersionRequest
} from '@reclaimprotocol/client/openapi'
import assert from 'node:assert'
import type { JSONSchema } from 'zod/v4/core'
import type { KeptScriptRef } from '../../../authoring/index.ts'
import {
	ALLOWED_REQUESTS_HINT,
	COOKIE_ATTACHMENT_HINT,
	USER_SCRIPT_HINT,
} from '../../../provider/injection-doc.ts'
import {
	countsFor,
	matchRedactionWarnings,
} from '../../../provider/match-redaction-warning.ts'
import {
	postPublishBrowserNotes
} from '../../../provider/post-publish-browser.ts'
import type { ReclaimProvider } from '../../../provider/schema.ts'
import type { AllowedJsRequest } from '../../../provider/to-version.ts'
import {
	providerToCreateVersionRequest,
	resolveNewVersion,
	type VersionBump,
} from '../../../provider/to-version.ts'
import { defineTool, type RegisteredTool } from '../../server.ts'
import type { AttachState } from './attach.ts'

/** Schemas shared by the top-level `provider`/`providers` and the lighter
 *  `allowedJsRequests` drafts — keeps the request shape from drifting between
 *  them. */
const RESPONSE_MATCHES_SCHEMA: JSONSchema.Schema = {
	type: 'array',
	description: 'What the attestor checks on the revealed response slice.',
	items: {
		type: 'object',
		properties: {
			type: { type: 'string', enum: ['regex', 'contains'] },
			value: { type: 'string' },
			isOptional: {
				type: 'boolean',
				description:
					'Mark this match non-fatal (verification continues when it ' +
					'fails). Default false.',
			},
		},
		required: ['type', 'value'],
	},
}

const RESPONSE_REDACTIONS_SCHEMA: JSONSchema.Schema = {
	type: 'array',
	description:
		'Which portions of the response the prover reveals ' +
		'(xPath / jsonPath / regex; hash to OPRF the value). Paired with ' +
		'responseMatches by index — keep them aligned 1-to-1. If you list more ' +
		'redactions than matches, the tool pads matches with no-op optional ' +
		'entries so older index-paired claim creators stay happy.',
	items: {
		type: 'object',
		properties: {
			xPath: { type: 'string' },
			jsonPath: { type: 'string' },
			regex: { type: 'string' },
			hash: { type: 'string', enum: ['oprf', 'oprf-mpc', 'oprf-raw'] },
		},
	},
}

/** Properties every drafted request shares (top-level providers and the
 *  injected `allowedJsRequests`). */
const REQUEST_DRAFT_PROPERTIES: Record<string, JSONSchema.Schema> = {
	url: {
		type: 'string',
		description:
			'Exact API URL the attestor replays, with {{param}} placeholders ' +
			'for any templated values.',
	},
	method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH'] },
	body: { type: 'string', description: 'Request body template, if any.' },
	credentials: {
		type: 'string',
		enum: ['omit', 'same-origin', 'include'],
		description:
			'How the verification client supplies cookies/auth when replaying ' +
			'this request. Default `include`.',
	},
	responseMatches: RESPONSE_MATCHES_SCHEMA,
	responseRedactions: RESPONSE_REDACTIONS_SCHEMA,
}

/** A full provider draft (from propose_provider), passed through verbatim. */
const PROVIDER_SCHEMA: JSONSchema.Schema = {
	type: 'object',
	description:
		'A `provider` object from propose_provider, passed through verbatim — ' +
		'the tool builds the version body (the requests[] entry and so on) ' +
		'for you.',
	properties: {
		name: { type: 'string', description: 'Verification name.' },
		...REQUEST_DRAFT_PROPERTIES,
		headers: {
			type: 'object',
			description:
				'Request headers from the capture. Secret headers are stripped ' +
				'before persistence; the client re-supplies them at runtime.',
		},
		paramValues: {
			type: 'object',
			description:
				'Real values for the {{param}} placeholders, for example, ' +
				'{ "username": "Syed" }.',
		},
	},
	required: ['name', 'url', 'method', 'responseMatches'],
}

/** One `allowedJsRequests` template: a request the injection script may fire,
 *  plus pagination/optionality flags. */
const ALLOWED_JS_REQUEST_SCHEMA: JSONSchema.Schema = {
	type: 'object',
	properties: {
		...REQUEST_DRAFT_PROPERTIES,
		multiple: {
			type: 'boolean',
			description:
				'Allow the template to match many requests (for example, ' +
				'pagination). Default true.',
		},
		required: {
			type: 'boolean',
			description:
				'Fail validation if no request matches this template. Default true.',
		},
	},
	required: ['url', 'method'],
}

const BROWSER_REQUEST_ACTION_SCHEMA: JSONSchema.Schema = {
	type: 'object',
	description:
		'Portal-only authenticated browser action. The page supplies the action ' +
		'id and declared primitive inputs; this object fixes the HTTPS origin, ' +
		'request template, and returned fields.',
	properties: {
		id: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,99}$' },
		origin: { type: 'string', pattern: '^https://[^/?#]+$' },
		path: { type: 'string', pattern: '^/(?:$|[^/\\\\][^\\\\]*)$' },
		pathTemplate: {
			type: 'string',
			pattern: '^/(?:$|[^/\\\\][^\\\\]*)$',
			description:
				'Origin-relative path/query template using `{{name}}` inputs.',
		},
		method: {
			type: 'string',
			enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
		},
		transport: { type: 'string', enum: ['fetch', 'navigate'] },
		userAgent: {
			type: 'string',
			minLength: 1,
			maxLength: 300,
			pattern: '^[^\\r\\n]+$',
			description:
				'Browser User-Agent applied before the isolated action page navigates.',
		},
		omitOriginHeader: {
			type: 'boolean',
			description:
				'Remove Chromium\'s automatic Origin header from a fetch action. ' +
				'Unsupported for navigate actions.',
		},
		headers: {
			type: 'object',
			additionalProperties: { type: 'string' },
		},
		headersTemplate: {
			type: 'object',
			description: 'Header values may interpolate declared `{{name}}` inputs.',
			additionalProperties: { type: 'string' },
		},
		bodyTemplate: {
			type: 'string',
			description: 'JSON template using declared `{{name}}` inputs.',
		},
		cookieValueHeader: {
			type: 'object',
			properties: {
				name: { type: 'string' },
				cookieName: { type: 'string' },
			},
			required: ['name', 'cookieName'],
		},
		includeBody: { type: 'boolean' },
		inputKeys: {
			type: 'array',
			items: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_]{0,99}$' },
		},
		responseFields: {
			type: 'array',
			items: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_]{0,99}$' },
		},
	},
	required: ['id', 'origin', 'path', 'method'],
}

interface PublishArgs {
	providerId: string
	/** Single-provider back-compat input; normalized to `[provider]`. */
	provider?: ReclaimProvider
	/** Multi-request input — one version carrying every request. */
	providers?: ReclaimProvider[]
	initialUrl: string
	notes?: string
	version?: { major: number, minor: number, patch: number }
	bump?: VersionBump
	requiredContext?: CreateProviderVersionRequest['requiredContext']
	jsUserScripts?: string
	allowedJsRequests?: AllowedJsRequest[]
	browserRequestActions?: NonNullable<
		CreateProviderVersionRequest['webSettings']['browserRequestActions']
	>
	interceptorOptions?: {
		interceptorType: 'HAWKEYE' | 'MSWJS' | 'CDP'
		interceptorSettings?: string
		isDocumentRequestReplayEnabled?: boolean
	}
}

export function createVersionFromCaptureTool(
	client: ReclaimClient,
	attachRef?: { current?: AttachState },
	kept?: KeptScriptRef,
): RegisteredTool {
	return defineTool<PublishArgs>(
		{
			name: 'create_provider_version_from_capture',
			description:
				'Creates a new immutable provider version after `run_proof` succeeds, '
				+ 'or from the captured draft when the site keeps answering replay or '
				+ 'proof with 403 past the retry budget in '
				+ 'how_it_works({ topic: "prove" }). '
				+ 'Publishes the navigation script kept by `test_user_script` as '
				+ '`jsUserScripts` unless `jsUserScripts` is passed. Pass exactly '
				+ 'one `provider` or `providers` value returned by '
				+ '`propose_provider`; do not rebuild the recipe. The default is a '
				+ 'patch bump, or use `bump` or an explicitly requested higher '
				+ '`version`. The new version remains a draft until published or '
				+ 'submitted for review. Read `_notes` and '
				+ 'how_it_works({ topic: "publish" }).',
			inputSchema: {
				type: 'object',
				properties: {
					providerId: {
						type: 'string',
						description: 'UUID of the provider to publish the version on.',
					},
					provider: PROVIDER_SCHEMA,
					providers: {
						type: 'array',
						description:
							'Multiple proven drafts → one multi-request version. Each ' +
							'entry has the same shape as `provider`. Pass this OR ' +
							'`provider`, not both.',
						items: PROVIDER_SCHEMA,
						minItems: 1,
					},
					initialUrl: {
						type: 'string',
						description:
							'The website URL the user landed on to trigger the request ' +
							'(for example, https://github.com/Syed). The URL the ' +
							'verification flow opens for end-users — NOT the API URL ' +
							'inside the provider.',
					},
					notes: {
						type: 'string',
						description:
							'Short change note (for example, "Initial draft from ' +
							'browser capture").',
					},
					version: {
						type: 'object',
						description:
							'Exact new semver requested by the user. It must be higher ' +
							'than the current highest version. Do not pass with `bump`.',
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
							'`patch`. Do not pass with an exact `version`.',
					},
					requiredContext: {
						type: 'object',
						description:
							'Complete JSON Schema for consumer-supplied session context. ' +
							'Omit to derive string properties from {{context.<name>}} ' +
							'placeholders. Pass refinements while creating this new ' +
							'version; never update the created version in place.',
						additionalProperties: true,
					},
					jsUserScripts: {
						type: 'string',
						description:
							'Defaults to the script kept by `test_user_script` with ' +
							'`keep: true`; pass it only to override. ' +
							USER_SCRIPT_HINT +
							' Stored as webSettings.jsUserScripts; the Builder ' +
							'verification client runs it before every page load ' +
							'(including before navigating to initialUrl), matching ' +
							'old-devtools customInjection. window.Reclaim is available ' +
							'for supported bridge actions; prefer plain browser JS for ' +
							'navigation and interaction.',
					},
					allowedJsRequests: {
						type: 'array',
						description:
							'Extra requests the user script is allowed to fire (for ' +
							'example, paginated API calls), as ' +
							'RequestSelectionTemplates. ' +
							'`multiple`/`required` default to true. Old-devtools calls the ' +
							'same concept `allowedInjectedRequestData`. ' +
							ALLOWED_REQUESTS_HINT,
						items: ALLOWED_JS_REQUEST_SCHEMA,
					},
					browserRequestActions: {
						type: 'array',
						description:
							'Portal-only actions available to jsUserScripts through ' +
							'window.Reclaim.browserRequest. Use these for bounded ' +
							'same-origin requests that need the browser cookie jar. ' +
							'Other Verification Clients currently ignore them.',
						items: BROWSER_REQUEST_ACTION_SCHEMA,
					},
					interceptorOptions: {
						type: 'object',
						description:
							'In-app interception settings, stored as ' +
							'webSettings.clientOptions.inapp.interceptorOptions — only ' +
							'needed for a genuine live-interception provider (a real ' +
							'HAWKEYE/MSWJS script, not the standard capture→replay flow). ' +
							COOKIE_ATTACHMENT_HINT,
						properties: {
							interceptorType: {
								type: 'string',
								enum: ['HAWKEYE', 'MSWJS', 'CDP'],
								description: 'How traffic interception is implemented.',
							},
							interceptorSettings: {
								type: 'string',
								description:
									'Free-form JSON config for the chosen interceptor.',
							},
							isDocumentRequestReplayEnabled: {
								type: 'boolean',
								description:
									'Whether the page\'s own document/navigation request is ' +
									'genuinely replayed through the interceptor, rather than ' +
									'constructed locally. Defaults to `false` (disabled) when ' +
									'omitted. Only meaningful for HAWKEYE/MSWJS — pass `true` ' +
									'when the target value is embedded in the page\'s own HTML ' +
									'rather than a separate API call. Inert for CDP.',
							},
						},
						required: ['interceptorType'],
					},
				},
				required: ['providerId', 'initialUrl'],
			},
			annotations: { openWorldHint: true, destructiveHint: false },
		},
		async(args) => {
			const jsUserScripts = args.jsUserScripts ?? kept?.keptScript?.script
			// Exactly one of `provider` / `providers` — normalize to an array.
			const hasMany = Array.isArray(args.providers) && args.providers.length > 0
			const hasOne = !!args.provider
			if(hasMany === hasOne) {
				throw new Error(
					'Pass exactly one of `provider` (a single draft) or ' +
					'`providers` (an array of 1+ drafts).',
				)
			}

			const providers = hasMany ? args.providers! : [args.provider!]

			assert(
				!(args.version && args.bump),
				badRequest('Pass either `version` or `bump`, not both.'),
			)
			const ver = await resolveNewVersion(client, args.providerId, {
				version: args.version,
				bump: args.bump,
			})

			const body = providerToCreateVersionRequest(providers, args.initialUrl, {
				notes: args.notes,
				version: ver,
				requiredContext: args.requiredContext,
				jsUserScripts,
				allowedJsRequests: args.allowedJsRequests,
				browserRequestActions: args.browserRequestActions,
				interceptorOptions: args.interceptorOptions,
			})
			const result = await client.call('CreateProviderVersion', {
				params: { providerId: args.providerId },
				body,
			})

			const created = result.data

			// Aggregate non-blocking advisories for the dev — nothing here blocks
			// or alters what was published; the author keeps full control.
			const notes: string[] = []

			// Match/redaction advisory across every request (+ injected requests).
			const requestCounts = [
				...providers.map((p, i) => countsFor(`Request ${i + 1}`, p)),
				...(args.allowedJsRequests ?? []).map(
					(r, i) => countsFor(`Injected request ${i + 1}`, r),
				),
			]
			notes.push(...matchRedactionWarnings(requestCounts))

			// A browser session left attached after a successful publish is easy
			// to forget about — surface it so the caller asks the developer
			// before closing it (a builder-mode session is quota-accounted and
			// otherwise just sits until its TTL expires).
			const attached = attachRef?.current
			notes.push(...postPublishBrowserNotes(attached, {
				initialUrl: args.initialUrl,
				hasUserScript: !!jsUserScripts?.trim(),
				hasInterceptor: !!args.interceptorOptions,
			}))

			// Let the developer know how and when the script runs.
			if(jsUserScripts?.trim()) {
				notes.push(
					'jsUserScripts will run in the Builder verification client before ' +
					'every page load (before navigating to initialUrl), matching ' +
					'old-devtool customInjection. window.Reclaim is available for ' +
					'supported bridge actions; prefer plain browser JS for navigation ' +
					'and interaction.',
				)
			}

			return notes.length ? { ...created, _notes: notes } : created
		},
	)
}
