/**
 * `propose_provider` — draft a provider (recipe + captured secrets) from ONE
 * captured request, one match + redaction per target value. Authored once as a
 * plain {@link RegisteredTool}; hosts pass their own backend resolver. The
 * draft (recipe + real secret header values) is held server-side under an
 * opaque `draftId`; the result carries only the secret-free provider.
 */
import { objectSchema, type ResolveBackend } from '../../../authoring/util.ts'
import { draftProvider, type DraftTarget } from '../../../provider/draft.ts'
import { OPRF_MAX_BYTES } from '../../../provider/matcher.ts'
import type { OprfMode } from '../../../provider/schema.ts'
import { stripTransportHeaders } from '../../../provider/secrets.ts'
import { verificationWarnings } from '../../../provider/verification-checks.ts'
import { defineTool, type RegisteredTool } from '../../../tools/registry.ts'

export function proposeTool(resolveBackend: ResolveBackend): RegisteredTool {
	return defineTool<Record<string, unknown>>(
		{
			name: 'propose_provider',
			description:
				'Drafts a provider from one authenticated captured request and '
				+ 'keeps captured secrets server-side. Use `targets` for the data '
				+ 'points the claim needs from that response; returns a `draftId` '
				+ 'and a secret-free recipe. Set `shortenNames: false` to preserve an '
				+ 'explicit parameter name, including a hidden `REQ_` or `URL_` '
				+ 'prefix. Hashing is opt-in: set `hash` only when the app must '
				+ 'match a private value without reading it; sensitive-looking '
				+ 'values come back as `hashRecommendations` instead. Set '
				+ '`optional` on a target to let verification pass without it. '
				+ 'For matching and naming guidance, call '
				+ 'how_it_works({ topic: "draft" }) and topic `params`.',
			inputSchema: objectSchema(
				{
					requestId: { type: 'string' },
					name: { type: 'string' },
					userRequest: {
						type: 'string',
						maxLength: 500,
						description:
							'The developer\'s request in their own words, as they wrote it. '
							+ 'Reclaim records this text to improve the product, so leave '
							+ 'out secrets and personal data.',
					},
					shortenNames: {
						type: 'boolean',
						description:
							'Default true: shorten each target `name` to its last '
							+ 'alphanumeric token, lowercased, to form the param key. '
							+ 'Set false to use `name` verbatim instead (must be a plain '
							+ 'identifier — lower_snake_case recommended).',
					},
					targets: {
						type: 'array',
						items: {
							type: 'object',
							properties: {
								value: { type: 'string' },
								name: {
									type: 'string',
									description:
										'Parameter key. See `shortenNames`. Keep it unique. '
										+ 'For hidden internal values, use `REQ_` or `URL_`. Set '
										+ '`shortenNames: false`. The prefix hides it from the '
										+ 'data-point UI but preserves substitution.',
								},
								hash: {
									type: 'string',
									enum: ['oprf-raw', 'oprf', 'oprf-mpc'],
								},
								optional: {
									type: 'boolean',
									description:
										'Verification still passes when this data point is '
										+ 'absent from the response.',
								},
							},
							required: ['value', 'name'],
						},
					},
					target: { type: 'string' },
					hash: { type: 'string', enum: ['oprf-raw', 'oprf', 'oprf-mpc'] },
				},
				['requestId', 'name'],
			),
			annotations: { openWorldHint: false, destructiveHint: false },
		},
		async(args) => {
			const backend = resolveBackend(args)
			const requestId = String(args.requestId)
			const providerName = String(args.name)
			const defaultHash = args.hash as OprfMode | undefined
			const shortenNames = typeof args.shortenNames === 'boolean'
				? args.shortenNames
				: true

			// Explicit multi-value `targets`, else the single `target` shorthand.
			const raw = Array.isArray(args.targets) ? args.targets : []
			const targets: DraftTarget[] = raw.length
				? raw.map((t) => {
					const o = t as Record<string, unknown>
					return {
						value: String(o.value),
						name: String(o.name),
						...(typeof o.hash === 'string'
							? { hash: o.hash as OprfMode }
							: {}),
						...(o.optional === true ? { optional: true } : {}),
					}
				})
				: typeof args.target === 'string'
					? [{
						value: args.target,
						name: providerName,
						...(defaultHash ? { hash: defaultHash } : {}),
					}]
					: []
			if(targets.length === 0) {
				throw new Error(
					'propose_provider needs a `target` value or a non-empty '
					+ '`targets` array',
				)
			}

			for(const t of targets) {
				const bytes = Buffer.byteLength(t.value, 'utf8')
				if((t.hash ?? defaultHash) !== undefined && bytes > OPRF_MAX_BYTES) {
					throw new Error(
						`OPRF caps hashed values at ${OPRF_MAX_BYTES} bytes; got `
						+ `${bytes}-byte "${t.value}". Use a tighter target or drop `
						+ '`hash`.',
					)
				}
			}

			const captured = backend.capture.requests.get(requestId)
			if(!captured) {
				throw new Error(`no captured request ${requestId}`)
			}

			if(!captured.responseBody) {
				throw new Error(`request body unavailable for ${requestId}`)
			}

			const {
				provider, secretRefs, extractions, droppedHeaders, hashRecommendations,
			} = draftProvider(
				captured, targets, providerName, defaultHash, { shortenNames },
			)
			// Materialize the real secret header values for later replay/prove;
			// they stay in the server-side draft, never in this result.
			const secrets: Record<string, string> = {}
			const headers = stripTransportHeaders(captured.requestHeaders)
			for(const ref of secretRefs) {
				const real = headers[ref.name]
				if(real !== undefined) {
					secrets[ref.name] = real
				}
			}

			const draftId = backend.drafts.put({
				provider, secretRefs, secrets, requestId, extractions,
			})
			const warnings = verificationWarnings(provider)
			const notes: string[] = []
			if(droppedHeaders.length) {
				notes.push(
					'Captured headers left out of the draft: '
					+ `${droppedHeaders.join(', ')}. `
					+ 'They looked per-request, so they are not in the recipe. If '
					+ 'replay fails without one, tell the developer.',
				)
			}

			if(hashRecommendations.length) {
				notes.push(
					'With a hash the app receives a hash, not the value. Support for '
					+ 'OPRF modes varies by verification client. Confirm with the '
					+ 'developer before adding one with update_draft.',
				)
			}

			return {
				draftId,
				provider,
				secretRefs,
				...(hashRecommendations.length ? { hashRecommendations } : {}),
				...(notes.length ? { _notes: notes } : {}),
				...(warnings.length ? { verificationWarnings: warnings } : {}),
			}
		},
	)
}
