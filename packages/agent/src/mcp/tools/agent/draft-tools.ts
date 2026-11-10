/**
 * `check_matchers` and `update_draft` — inspect and edit a draft's matchers
 * without leaving MCP. `check_matchers` runs a recipe's redactions + matches
 * against a captured response with attestor-core's own engine, offline (see
 * proof/check-matchers.ts); `update_draft` replaces a draft's matchers in place
 * after the same validation and portability gate `propose_provider` applies.
 */
import { badRequest } from '@hapi/boom'
import assert from 'node:assert'
import type { JSONSchema } from 'zod/v4/core'
import type { Draft } from '../../../authoring/backend.ts'
import { checkMatchersOffline } from '../../../proof/check-matchers.ts'
import { type DraftEdit, editDraftProvider } from '../../../provider/draft.ts'
import type {
	ResponseMatch,
	ResponseRedaction,
} from '../../../provider/schema.ts'
import { verificationWarnings } from '../../../provider/verification-checks.ts'
import { defineTool, type RegisteredTool } from '../../server.ts'
import type { CaptureEntry, CaptureStore } from './capture.ts'

const MATCHES_SCHEMA = {
	type: 'array',
	minItems: 1,
	items: {
		type: 'object',
		properties: {
			type: { type: 'string', enum: ['contains', 'regex'] },
			value: { type: 'string' },
			invert: { type: 'boolean' },
		},
		required: ['type', 'value'],
	},
} satisfies JSONSchema.Schema

const REDACTIONS_SCHEMA = {
	type: 'array',
	items: {
		type: 'object',
		properties: {
			xPath: { type: 'string' },
			jsonPath: { type: 'string' },
			regex: { type: 'string' },
			hash: { type: 'string', enum: ['oprf', 'oprf-raw', 'oprf-mpc'] },
		},
	},
} satisfies JSONSchema.Schema

const PARAM_VALUES_SCHEMA = {
	type: 'object',
	additionalProperties: { type: 'string' },
} satisfies JSONSchema.Schema

interface MatcherArgs {
	captureId: string
	draftId: string
	responseMatches?: ResponseMatch[]
	responseRedactions?: ResponseRedaction[]
	paramValues?: Record<string, string>
	geoLocation?: string
}

export function draftTools(captures: CaptureStore): RegisteredTool[] {
	const checkMatchers = defineTool<MatcherArgs & { requestId?: string }>(
		{
			name: 'check_matchers',
			description:
				'Checks a draft\'s `responseRedactions` and `responseMatches` '
				+ 'against the captured response, offline, with the attestor\'s own '
				+ 'redaction and match engine. No network call. Returns `ok`, '
				+ '`failedAt` and `reason` on failure, `extractedParameters`, and the '
				+ '`revealed` body slices the attestor would see (truncated). Pass '
				+ '`responseMatches`, `responseRedactions`, or `paramValues` to try '
				+ 'an edit without saving it, and `requestId` to check against a '
				+ 'different captured request. Run it before `run_proof`.',
			inputSchema: {
				type: 'object',
				properties: {
					captureId: { type: 'string' },
					draftId: { type: 'string' },
					requestId: {
						type: 'string',
						description: 'Captured request whose response to check. '
							+ 'Defaults to the request the draft was proposed from.',
					},
					responseMatches: MATCHES_SCHEMA,
					responseRedactions: REDACTIONS_SCHEMA,
					paramValues: PARAM_VALUES_SCHEMA,
				},
				required: ['captureId', 'draftId'],
			},
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		async(args) => {
			const { entry, draft } = resolveDraft(captures, args)
			const provider = hasEdit(args)
				? editDraftProvider(draft.provider, draft.extractions, args).provider
				: draft.provider
			return checkCaptured(entry, args.requestId ?? draft.requestId, provider)
		},
	)

	const updateDraft = defineTool<MatcherArgs & { check?: boolean }>(
		{
			name: 'update_draft',
			description:
				'Replaces a draft\'s `responseMatches`, `responseRedactions`, '
				+ '`paramValues`, or `geoLocation` in place; the `draftId` stays '
				+ 'the same. Validates '
				+ 'regexes and selectors and rejects a matcher that bakes a captured '
				+ 'value in as a literal, or redactions that reveal more of the '
				+ 'captured response than the draft did. Returns the secret-free '
				+ 'provider and, unless `check` is false, a `check_matchers` '
				+ 'result for the edit. '
				+ 'Prefer `propose_provider` with a better request or target; use '
				+ 'this to narrow or fix what it drafted.',
			inputSchema: {
				type: 'object',
				properties: {
					captureId: { type: 'string' },
					draftId: { type: 'string' },
					responseMatches: MATCHES_SCHEMA,
					responseRedactions: REDACTIONS_SCHEMA,
					paramValues: PARAM_VALUES_SCHEMA,
					geoLocation: {
						type: 'string',
						description:
							'ISO country the published version\'s request goes out from, '
							+ 'for example `US`, or `{{DYNAMIC_GEO}}` (the default) for '
							+ 'the verifying user\'s own country. Pin a country when '
							+ 'run_proof only verified with that `geoLocation`.',
					},
					check: {
						type: 'boolean',
						description: 'Default true: run `check_matchers` on the edit.',
					},
				},
				required: ['captureId', 'draftId'],
			},
			annotations: { openWorldHint: false, destructiveHint: false },
		},
		async(args) => {
			const { entry, draft } = resolveDraft(captures, args)
			assert(
				hasEdit(args),
				badRequest(
					'Pass at least one of responseMatches, responseRedactions, '
					+ 'paramValues, or geoLocation.',
				),
			)
			const edited = editDraftProvider(draft.provider, draft.extractions, args)
			// Redactions are what the attestor doesn't see, so an edit may narrow
			// them but never reveal more of the captured response than the draft.
			const before = checkCaptured(entry, draft.requestId, draft.provider)
			const check = checkCaptured(entry, draft.requestId, edited.provider)
			assert(
				check.failedAt !== 'request' && check.failedAt !== 'redaction',
				badRequest(
					'the edited recipe doesn\'t apply to the captured response '
					+ `(${check.failedAt}): ${check.reason}`,
				),
			)
			const comparable = before.failedAt !== 'request'
				&& before.failedAt !== 'redaction'
			assert(
				!comparable || check.revealedBytes <= before.revealedBytes,
				badRequest(
					`the edit reveals ${check.revealedBytes} bytes of the response `
					+ `to the attestor, more than the draft's ${before.revealedBytes}. `
					+ 'Keep redactions that hide everything except the proved values.',
				),
			)
			// The recipe changed, so an earlier replay no longer describes it.
			const { lastReplay: _stale, ...rest } = draft
			void _stale
			entry.drafts.set(args.draftId, {
				...rest,
				provider: edited.provider,
				extractions: edited.extractions,
			})
			const verification = verificationWarnings(edited.provider)
			return {
				draftId: args.draftId,
				provider: edited.provider,
				secretRefs: draft.secretRefs,
				...(edited.warnings.length ? { warnings: edited.warnings } : {}),
				...(verification.length
					? { verificationWarnings: verification }
					: {}),
				...(args.check === false ? {} : { check }),
			}
		},
	)

	return [checkMatchers, updateDraft]
}

function resolveDraft(
	captures: CaptureStore,
	{ captureId, draftId }: { captureId: string, draftId: string },
): { entry: CaptureEntry, draft: Draft } {
	const entry = captures.sessions.get(captureId)
	assert(
		entry,
		badRequest(
			`no capture ${captureId} — call start_capture first `
			+ '(it has been reset or never started).',
		),
	)
	const draft = entry.drafts.get(draftId)
	assert(draft, badRequest(`no draft ${draftId} in capture ${captureId}`))
	return { entry, draft }
}

function hasEdit(edit: DraftEdit): boolean {
	return edit.responseMatches !== undefined
		|| edit.responseRedactions !== undefined
		|| edit.paramValues !== undefined
		|| edit.geoLocation !== undefined
}

function checkCaptured(
	entry: CaptureEntry,
	requestId: string,
	provider: Draft['provider'],
) {
	const captured = entry.session.requests.get(requestId)
	assert(captured, badRequest(`no captured request ${requestId}`))
	assert(
		captured.responseBody,
		badRequest(`response body unavailable for ${requestId}`),
	)
	return { requestId, ...checkMatchersOffline(provider, captured) }
}
