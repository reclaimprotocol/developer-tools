/* eslint-disable @stylistic/max-len */
/** Minimal direct Responses adapter. No model SDK, Python, LangChain or agent service. */
import type {
	EmailModelClient,
	EmailModelIdentity,
	EmailModelRequest,
} from './ai.ts'
import { emailAiAbortable, EmailAiError } from './ai-errors.ts'
import {
	EMAIL_AI_RESPONSE_BYTES,
	parseEmailAiResponseJson,
} from './ai-response-json.ts'
export const DEFAULT_EMAIL_AI_MODEL = 'gpt-6-luna'
const OUTPUT_TOKENS = 16_384
const machineId = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value)
	? value
	: undefined
const transportCodes = new Set([
	'ECONNREFUSED',
	'ECONNRESET',
	'ENOTFOUND',
	'EAI_AGAIN',
	'ETIMEDOUT',
	'EPIPE',
	'UND_ERR_CONNECT_TIMEOUT',
	'UND_ERR_HEADERS_TIMEOUT',
	'UND_ERR_BODY_TIMEOUT',
	'UND_ERR_SOCKET',
	'CERT_HAS_EXPIRED',
	'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
	'DEPTH_ZERO_SELF_SIGNED_CERT',
])
// https://developers.openai.com/api/docs/models/gpt-6-luna (checked 2026-10-27).
const DEFAULT_CONTEXT_TOKENS = 1_050_000
export interface OpenAiEmailConfiguration {
	apiKey: string
	model?: string
	contextTokens?: number
}
export class OpenAiEmailClient implements EmailModelClient {
	readonly identity: EmailModelIdentity
	readonly #apiKey: string
	readonly #fetch: typeof fetch
	constructor(
		config: OpenAiEmailConfiguration,
		transport: typeof fetch = fetch,
	) {
		const model = config.model ?? DEFAULT_EMAIL_AI_MODEL
		const contextTokens =
			config.contextTokens ??
			(model === DEFAULT_EMAIL_AI_MODEL ? DEFAULT_CONTEXT_TOKENS : undefined)
		if(
			!/^[\x21-\x7e]{1,512}$/.test(config.apiKey) ||
			!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(model) ||
			!Number.isSafeInteger(contextTokens) ||
			contextTokens! < 20_480 ||
			contextTokens! > 2_000_000 ||
			(model === DEFAULT_EMAIL_AI_MODEL &&
				contextTokens! > DEFAULT_CONTEXT_TOKENS)
		) {
			throw new EmailAiError('EMAIL_AI_CONFIGURATION_INVALID')
		}

		this.identity = Object.freeze({
			provider: 'OpenAI',
			model,
			contextTokens: contextTokens!,
		})
		this.#apiKey = config.apiKey
		this.#fetch = transport
	}
	async complete(
		request: EmailModelRequest,
		signal: AbortSignal,
	): Promise<string> {
		let stage:
			| 'request'
			| 'response_body'
			| 'response_json'
			| 'response_output' = 'request'
		let metadata: { httpStatus?: number, requestId?: string } = {}
		try {
			signal.throwIfAborted()
			const response = await emailAiAbortable(
				this.#fetch('https://api.openai.com/v1/responses', {
					method: 'POST',
					redirect: 'error',
					cache: 'no-store',
					signal,
					headers: {
						'content-type': 'application/json',
						authorization: `Bearer ${this.#apiKey}`,
					},
					body: JSON.stringify({
						model: this.identity.model,
						store: false,
						background: false,
						stream: false,
						...(this.identity.model === DEFAULT_EMAIL_AI_MODEL
							? { reasoning: { effort: 'low' } }
							: {}),
						truncation: 'disabled',
						max_output_tokens: OUTPUT_TOKENS,
						tools: [],
						tool_choice: 'none',
						instructions: request.systemPrompt,
						input: [
							{ role: 'user', content: request.taskJson },
							{ role: 'user', content: request.sourcesJson },
						],
						text: {
							format: {
								type: 'json_schema',
								name: 'email_content_check',
								strict: true,
								schema: request.responseJsonSchema,
							},
						},
					}),
				}),
				signal,
			)
			metadata = {
				httpStatus: response.status,
				requestId: machineId(response.headers.get('x-request-id')),
			}
			stage = 'response_body'
			const reader = response.body?.getReader()
			if(!reader) {
				throw new EmailAiError('EMAIL_AI_PROVIDER_FAILED', {
					reason: 'MISSING_RESPONSE_BODY',
				})
			}

			const chunks: Uint8Array[] = []
			let length = 0
			try {
				for(;;) {
					const part = await emailAiAbortable(reader.read(), signal)
					if(part.done) {
						break
					}

					length += part.value.byteLength
					if(length > EMAIL_AI_RESPONSE_BYTES) {
						throw new EmailAiError('EMAIL_AI_INVALID_RESPONSE', {
							reason: 'RESPONSE_TOO_LARGE',
						})
					}

					chunks.push(part.value)
				}
			} finally {
				void reader.cancel().catch(() => {})
			}

			stage = 'response_json'
			if(!response.ok) {
				// Retain machine identifiers only. Provider messages can echo private inputs.
				// eslint-disable-next-line @typescript-eslint/no-explicit-any -- core copy: untyped provider JSON, checked field by field below
				let error: any
				try {
					error = (
						parseEmailAiResponseJson(
							Buffer.concat(chunks).toString('utf8'),
						// eslint-disable-next-line @typescript-eslint/no-explicit-any -- core copy: untyped provider JSON, checked field by field below
						) as any
					)?.error
				} catch{}

				throw new EmailAiError('EMAIL_AI_PROVIDER_FAILED', {
					httpStatus: response.status,
					providerCode: machineId(error?.code),
					providerType: machineId(error?.type),
					reason: 'HTTP_ERROR',
				})
			}

			const data = parseEmailAiResponseJson(
				new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
					Buffer.concat(chunks),
				),
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- core copy: untyped provider JSON, checked field by field below
			) as any
			stage = 'response_output'
			if(
				// eslint-disable-next-line @typescript-eslint/prefer-optional-chain
				!data ||
				data.status !== 'completed' ||
				data.error ||
				data.incomplete_details ||
				!Array.isArray(data.output)
			) {
				throw new EmailAiError('EMAIL_AI_INCOMPLETE_RESPONSE', {
					...([
						'completed',
						'failed',
						'incomplete',
						'cancelled',
						'queued',
						'in_progress',
					].includes(data?.status)
						? { responseStatus: data.status }
						: {}),
					...(['max_output_tokens', 'content_filter'].includes(
						data?.incomplete_details?.reason,
					)
						? { incompleteReason: data.incomplete_details.reason }
						: {}),
				})
			}

			const messages = data.output.filter(
				// eslint-disable-next-line @typescript-eslint/no-explicit-any -- core copy: untyped provider JSON, checked field by field below
				(item: any) => item?.type === 'message',
			)
			if(
				messages.length !== 1 ||
				data.output.some(
					// eslint-disable-next-line @typescript-eslint/no-explicit-any -- core copy: untyped provider JSON, checked field by field below
					(item: any) => !['message', 'reasoning'].includes(item?.type),
				)
			) {
				throw new EmailAiError('EMAIL_AI_INCOMPLETE_RESPONSE')
			}

			const message = messages[0]
			if(
				message.role !== 'assistant' ||
				message.status !== 'completed' ||
				!Array.isArray(message.content) ||
				!message.content.length ||
				message.content.some(
					// eslint-disable-next-line @typescript-eslint/no-explicit-any -- core copy: untyped provider JSON, checked field by field below
					(part: any) => part?.type !== 'output_text' || typeof part.text !== 'string',
				)
			) {
				throw new EmailAiError('EMAIL_AI_INCOMPLETE_RESPONSE')
			}

			signal.throwIfAborted()
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- core copy: untyped provider JSON, checked field by field below
			return message.content.map((part: any) => part.text).join('')
		} catch(error) {
			if(signal.aborted) {
				throw new EmailAiError('EMAIL_AI_CANCELLED')
			}

			if(error instanceof EmailAiError) {
				throw new EmailAiError(error.code, {
					...metadata,
					stage,
					...error.diagnostic,
				})
			}

			if(stage === 'response_json') {
				throw new EmailAiError('EMAIL_AI_INVALID_RESPONSE', {
					...metadata,
					stage,
					reason: 'INVALID_RESPONSE_JSON',
				})
			}

			// Never log exception messages, URLs, raw response bodies or arbitrary cause codes.
			const cause =
				error instanceof Error
					? (error.cause as { code?: unknown } | undefined)?.code
					: undefined
			const transportCode =
				typeof cause === 'string' && transportCodes.has(cause)
					? cause
					: undefined
			throw new EmailAiError('EMAIL_AI_PROVIDER_FAILED', {
				...metadata,
				stage,
				reason: 'TRANSPORT_ERROR',
				...(transportCode ? { transportCode } : {}),
			})
		}
	}
}
