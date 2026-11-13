/* eslint-disable @stylistic/max-len */
/** Server-only AI stage. Import separately from the deterministic core and browser-safe contracts. */
import { z } from 'zod'
import { EmailContentCheckError, validateAiContentCheck } from './ai-check.ts'
import { emailAiAbortable, EmailAiError } from './ai-errors.ts'
import { modelEvidenceSchema, resolveModelEvidence } from './ai-evidence.ts'
import { EMAIL_PROMPT_VERSION, EMAIL_SYSTEM_PROMPT } from './ai-prompt.ts'
import { EmailApprovalError, projectApprovedEmail } from './approval.ts'
import {
	emailCheckCode,
	type EmailCheckObserver,
	type EmailCheckStep,
	reportEmailCheck,
} from './check-events.ts'
import type {
	AiContentCheckResult,
	ApprovedEmailContent,
	EmailParameter,
	TrustedEmailBinding,
} from './contracts.ts'
import { canonicalJson, freeze, sha256 } from './policy.ts'
import { strictJson } from './protocol.ts'
import { aiContentCheckSchema, emailParameterSchema } from './schemas.ts'
export { EMAIL_PROMPT_VERSION, EMAIL_SYSTEM_PROMPT, EmailAiError }
export {
	OpenAiEmailClient,
	DEFAULT_EMAIL_AI_MODEL,
	type OpenAiEmailConfiguration,
} from './ai-openai.ts'

export const EMAIL_AI_RESPONSE_LIMIT = 262_144
export const EMAIL_AI_OUTPUT_TOKENS = 16_384
export const EMAIL_AI_TIMEOUT_MS = 60_000
/** Initial attempt plus three fresh retries, with 1s/2s/4s backoff. */
export const EMAIL_AI_MAX_ATTEMPTS = 4
export const EMAIL_AI_TOTAL_TIMEOUT_MS =
	EMAIL_AI_TIMEOUT_MS * EMAIL_AI_MAX_ATTEMPTS + 7_000
const retryableAiCodes = new Set([
	'EMAIL_AI_PROVIDER_FAILED',
	'EMAIL_AI_TIMEOUT',
	'EMAIL_AI_INVALID_RESPONSE',
	'EMAIL_AI_INCOMPLETE_RESPONSE',
	'EMAIL_AI_CONTENT_FAILED',
	'EMAIL_AI_INSUFFICIENT',
	'EMAIL_AI_MISSING_REQUIRED',
	'EMAIL_AI_INVALID_EVIDENCE',
	'EMAIL_AI_INCOMPLETE_REVIEW',
	'EMAIL_AI_UNDECLARED_FIELD',
])
export interface EmailModelIdentity {
	readonly provider: string
	readonly model: string
	readonly contextTokens: number
}
export interface EmailModelRequest {
	readonly systemPrompt: string
	/** The caller task and complete source projection remain separate data messages. */
	readonly taskJson: string
	readonly sourcesJson: string
	readonly responseJsonSchema: Record<string, unknown>
}
export interface EmailModelClient {
	readonly identity: EmailModelIdentity
	complete(request: EmailModelRequest, signal: AbortSignal): Promise<string>
}
export interface EmailAiIdentity extends EmailModelIdentity {
	readonly promptVersion: typeof EMAIL_PROMPT_VERSION
	readonly configurationId: string
}
export type EmailAiConsent = Pick<EmailAiIdentity, 'model' | 'configurationId'>

/** Strict structured-output wire schema. Explicit nullable fields are decoded only at declared locations. */
function responseSchema(params: readonly EmailParameter[]) {
	const field = z.strictObject({
		value: z.string().max(1024),
		evidence: modelEvidenceSchema,
	})
	const fields = Object.fromEntries(
		params.map((p) => [emailParameterSchema.parse(p).name, field.nullable()]),
	)
	return z.strictObject({
		result: z.union([
			z.strictObject({
				outcome: z.literal('pass'),
				reviewedSourceIds: z
					.array(z.string().regex(/^(body|attachment):\d{1,6}$/))
					.min(1)
					.max(1000),
				fields: z.strictObject(fields),
			}),
			z.strictObject({
				outcome: z.enum(['fail', 'insufficient']),
				reason: z.string().min(1).max(2048),
			}),
		]),
	})
}

export class EmailAiProvider {
	readonly #client: EmailModelClient
	readonly #identity: EmailAiIdentity
	#active = 0
	constructor(client: EmailModelClient) {
		const { provider, model, contextTokens } = client.identity
		if(
			!/^[A-Za-z][A-Za-z0-9 ._-]{0,63}$/.test(provider) ||
			!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(model) ||
			!Number.isSafeInteger(contextTokens) ||
			contextTokens < 20_480 ||
			contextTokens > 2_000_000
		) {
			throw new EmailAiError('EMAIL_AI_CONFIGURATION_INVALID')
		}

		this.#client = client
		this.#identity = Object.freeze({
			provider,
			model,
			contextTokens,
			promptVersion: EMAIL_PROMPT_VERSION,
			configurationId: sha256(
				canonicalJson({
					provider,
					model,
					contextTokens,
					prompt: EMAIL_SYSTEM_PROMPT,
					version: EMAIL_PROMPT_VERSION,
					maxAttempts: EMAIL_AI_MAX_ATTEMPTS,
				}),
			),
		})
	}
	describe(signal?: AbortSignal): EmailAiIdentity {
		signal?.throwIfAborted()
		return this.#identity
	}
	async check(
		approved: ApprovedEmailContent,
		binding: TrustedEmailBinding,
		signal: AbortSignal,
		guard: () => Promise<void>,
		consent: EmailAiConsent,
		observer?: EmailCheckObserver,
	) {
		let step: EmailCheckStep = 'ai_input'
		const deadline = AbortSignal.any([
			signal,
			AbortSignal.timeout(EMAIL_AI_TIMEOUT_MS),
		])
		let counted = false
		try {
			deadline.throwIfAborted()
			await guard()
			const input = projectApprovedEmail(approved, binding)
			if(!input.sources.length) {
				throw new EmailAiError('NO_USABLE_CONTENT')
			}

			if(
				consent.model !== this.#identity.model ||
				consent.configurationId !== this.#identity.configurationId
			) {
				throw new EmailAiError('EMAIL_AI_CONFIGURATION_CHANGED')
			}

			if(this.#active >= 4) {
				throw new EmailAiError('EMAIL_AI_BUSY')
			}

			this.#active++
			counted = true
			const schema = responseSchema(input.params)
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			const { $schema: _dialect, ...responseJsonSchema } =
				z.toJSONSchema(schema)
			const request = freeze({
				systemPrompt: EMAIL_SYSTEM_PROMPT,
				taskJson: canonicalJson({
					task: {
						params: input.params,
						instructions: input.instructions,
						contentScope: input.contentScope,
					},
				}),
				sourcesJson: canonicalJson({ sources: input.sources }),
				responseJsonSchema,
			})
			// Conservative UTF-8 byte bound plus schema/framing/output reserve. Never truncate sources.
			const budget =
				Buffer.byteLength(JSON.stringify(request)) +
				EMAIL_AI_OUTPUT_TOKENS +
				4096
			if(budget > this.#identity.contextTokens) {
				throw new EmailAiError('EMAIL_AI_CAPACITY_EXCEEDED')
			}

			reportEmailCheck(observer, {
				step,
				status: 'passed',
				details: {
					provider: this.#identity.provider,
					model: this.#identity.model,
					sources: input.sources.length,
					fields: input.params.length,
					inputBudget: budget,
					contextTokens: this.#identity.contextTokens,
				},
			})
			deadline.throwIfAborted()
			step = 'ai_response'
			const text = await emailAiAbortable(
				this.#client.complete(request, deadline),
				deadline,
			)
			deadline.throwIfAborted()
			reportEmailCheck(observer, {
				step,
				status: 'returned',
				details: { characters: text.length },
				privateDetails: {
					response: text.slice(0, 32768),
					truncated: text.length > 32768,
				},
			})
			step = 'ai_schema'
			const decoded = schema.safeParse(
				strictJson(text, EMAIL_AI_RESPONSE_LIMIT),
			)
			if(!decoded.success) {
				reportEmailCheck(observer, {
					step,
					status: 'failed',
					code: 'EMAIL_AI_INVALID_RESPONSE',
					details: {
						issues: decoded.error.issues.map((i) => ({
							code: i.code,
							path: i.path,
						})),
					},
				})
				throw new EmailAiError('EMAIL_AI_INVALID_RESPONSE')
			}

			reportEmailCheck(observer, {
				step,
				status: 'passed',
				details: { outcome: decoded.data.result.outcome },
			})
			const result = decoded.data.result
			let candidate: AiContentCheckResult
			if(result.outcome === 'pass') {
				step = 'evidence_resolution'
				const fields: Extract<
					AiContentCheckResult,
					{ outcome: 'pass' }
				>['fields'] = Object.create(null)
				for(const [name, field] of Object.entries(result.fields)) {
					if(field === null) {
						continue
					}

					try {
						fields[name] = {
							value: field.value,
							evidence: resolveModelEvidence(input.sources, field.evidence),
						}
						reportEmailCheck(observer, {
							step,
							status: 'passed',
							details: {
								field: name,
								sourceId: field.evidence.sourceId,
								page: field.evidence.page,
							},
						})
					} catch(error) {
						reportEmailCheck(observer, {
							step,
							status: input.params.find((p) => p.name === name)?.isOptional
								? 'omitted'
								: 'failed',
							code: emailCheckCode(error, 'EMAIL_AI_INVALID_EVIDENCE'),
							details: {
								field: name,
								...(error instanceof EmailContentCheckError && error.detail
									? { check: error.detail }
									: {}),
							},
						})
						// eslint-disable-next-line max-depth
						if(
							!input.params.find((p) => p.name === name)?.isOptional ||
							!(error instanceof EmailContentCheckError)
						) {
							throw error
						}
					}
				}

				candidate = {
					outcome: 'pass',
					reviewedSourceIds: result.reviewedSourceIds,
					fields,
				}
			} else {
				candidate = result
			}

			const parsed = aiContentCheckSchema.safeParse(candidate)
			if(!parsed.success) {
				throw new EmailAiError('EMAIL_AI_INVALID_RESPONSE')
			}

			await guard()
			deadline.throwIfAborted()
			step = 'evidence_validation'
			const checked = validateAiContentCheck(
				approved,
				binding,
				parsed.data,
				{
					inputSha256: sha256(canonicalJson(input)),
					model: this.#identity.model,
					promptVersion: EMAIL_PROMPT_VERSION,
				},
				observer,
			)
			reportEmailCheck(observer, {
				step: 'analysis',
				status: 'passed',
				details: { outcome: 'review' },
			})
			return checked
		} catch(error) {
			reportEmailCheck(observer, {
				step,
				status: 'failed',
				code: deadline.aborted
					? signal.aborted
						? 'EMAIL_AI_CANCELLED'
						: 'EMAIL_AI_TIMEOUT'
					: emailCheckCode(error, 'EMAIL_AI_PROVIDER_FAILED'),
				details: {
					...(error instanceof EmailAiError ? error.diagnostic : {}),
					...(error instanceof EmailContentCheckError && error.detail
						? { check: error.detail }
						: {}),
				},
			})
			if(deadline.aborted) {
				throw new EmailAiError(
					signal.aborted ? 'EMAIL_AI_CANCELLED' : 'EMAIL_AI_TIMEOUT',
				)
			}

			// Preserve only domain errors from the local trust boundary; never echo provider diagnostics.
			if(
				error instanceof EmailAiError ||
				error instanceof EmailApprovalError ||
				error instanceof EmailContentCheckError
			) {
				throw error
			}

			throw new EmailAiError('EMAIL_AI_PROVIDER_FAILED')
		} finally {
			if(counted) {
				this.#active--
			}
		}
	}
}
export async function checkApprovedEmailContent(
	approved: ApprovedEmailContent,
	binding: TrustedEmailBinding,
	provider: EmailAiProvider,
	signal: AbortSignal,
	guard: () => Promise<void>,
	consent: EmailAiConsent,
	observer?: EmailCheckObserver,
) {
	// Approval/extraction is deliberately outside this loop. Each attempt rebuilds
	// the same source projection and task, without feeding back earlier responses.
	const remaining = Math.min(
		EMAIL_AI_TOTAL_TIMEOUT_MS,
		binding.expiresAt - Date.now(),
	)
	if(signal.aborted) {
		throw new EmailAiError('EMAIL_AI_CANCELLED')
	}

	if(remaining <= 0) {
		throw new EmailAiError('EMAIL_AI_TIMEOUT')
	}

	const deadline = AbortSignal.any([signal, AbortSignal.timeout(remaining)])
	for(let attempt = 1; ; attempt++) {
		let guardFailed = false
		const currentGuard = async() => {
			try {
				await guard()
			} catch(error) {
				guardFailed = true
				throw error
			}
		}

		const observe: EmailCheckObserver = (event) => reportEmailCheck(observer, {
			...event,
			details: {
				...event.details,
				aiAttempt: attempt,
				maxAiAttempts: EMAIL_AI_MAX_ATTEMPTS,
			},
		})
		try {
			return await emailAiAbortable(
				provider.check(
					approved,
					binding,
					deadline,
					currentGuard,
					consent,
					observe,
				),
				deadline,
			)
		} catch(error) {
			if(deadline.aborted) {
				throw new EmailAiError(
					signal.aborted ? 'EMAIL_AI_CANCELLED' : 'EMAIL_AI_TIMEOUT',
				)
			}

			// Ownership, consent, stale approval, input capacity and concurrency failures
			// are not model failures. Never retry an authorization guard's exception.
			if(
				guardFailed ||
				!(
					error instanceof EmailAiError ||
					error instanceof EmailContentCheckError
				) ||
				!retryableAiCodes.has(error.code) ||
				attempt >= EMAIL_AI_MAX_ATTEMPTS
			) {
				throw error
			}
		}

		let timer: ReturnType<typeof setTimeout> | undefined
		try {
			await emailAiAbortable(
				new Promise<void>((resolve) => {
					timer = setTimeout(resolve, 1000 * 2 ** (attempt - 1))
				}),
				deadline,
			)
		} catch{
			throw new EmailAiError(
				signal.aborted ? 'EMAIL_AI_CANCELLED' : 'EMAIL_AI_TIMEOUT',
			)
		} finally {
			clearTimeout(timer)
		}
	}
}
