/* eslint-disable @stylistic/max-len -- ported from the email core's test suite; kept close to upstream so the two can be compared */
import {
	EmailAiProvider,
	OpenAiEmailClient,
} from '../../../src/email/core/ai.ts'
import {
	approveWithResolver,
	projectApprovedEmail,
	releaseApprovedEmail,
} from '../../../src/email/core/approval.ts'
import type { EmailCheckEvent } from '../../../src/email/core/check-events.ts'
import {
	fixtureBinding,
	fixturePolicy,
	fixtureResolver,
	signCoreEmail,
} from './fixtures/email-core.ts'
import { expect, it } from './vitest-compat.ts'

it('records every authentication step and keeps addresses out of public diagnostics', async() => {
	const policy = fixturePolicy(),
		binding = fixtureBinding(policy),
		events: EmailCheckEvent[] = []
	const approved = await approveWithResolver(
		await signCoreEmail(),
		policy,
		binding,
		new AbortController().signal,
		fixtureResolver,
		(event) => {
			events.push(event)
		},
	)
	try {
		expect(events.map((e) => e.step)).toEqual([
			'snapshot',
			'dkim',
			'signed_headers',
			'sender',
			'recipient',
			'date',
			'mime',
			'extraction',
			'extraction',
			'approval',
		])
		expect(events.find((e) => e.step === 'dkim')?.details).toMatchObject({
			signatures: [{ result: 'pass' }],
		})
		expect(
			events.find((e) => e.step === 'recipient')?.privateDetails,
		).toMatchObject({ account: 'alice@example.net' })
		const publicEvents = events.map(({ privateDetails, ...e }) => (void privateDetails, e))
		expect(JSON.stringify(publicEvents)).not.toMatch(
			/alice@|publisher@|Synthetic weekly income/,
		)
		expect(events.at(-1)?.status).toBe('passed')
	} finally {
		releaseApprovedEmail(approved)
	}
})

it('reports the precise failed identity step, even though DKIM succeeded', async() => {
	const policy = fixturePolicy(),
		binding = fixtureBinding(policy),
		events: EmailCheckEvent[] = []
	await expect(
		approveWithResolver(
			await signCoreEmail({ to: 'other@example.net' }),
			policy,
			binding,
			new AbortController().signal,
			fixtureResolver,
			(e) => {
				events.push(e)
			},
		),
	).rejects.toThrow('RECIPIENT_NOT_ACCEPTED')
	expect(events.find((e) => e.step === 'dkim')?.status).toBe('passed')
	expect(events).toContainEqual(
		expect.objectContaining({
			step: 'recipient',
			status: 'failed',
			code: 'RECIPIENT_NOT_ACCEPTED',
		}),
	)
	expect(events.some((e) => e.step === 'extraction')).toBe(false)
})

it('retains actual model output only as private diagnostics and identifies an invalid quote', async() => {
	const policy = fixturePolicy(),
		binding = fixtureBinding(policy),
		events: EmailCheckEvent[] = []
	const approved = await approveWithResolver(
		await signCoreEmail(),
		policy,
		binding,
		new AbortController().signal,
		fixtureResolver,
	)
	try {
		const source = projectApprovedEmail(approved, binding).sources[0]
		const response = JSON.stringify({
			result: {
				outcome: 'pass',
				reviewedSourceIds: [source.id],
				fields: {
					income: {
						value: '99',
						evidence: {
							sourceId: source.id,
							page: null,
							quoteBefore: 'PRIVATE invented income ',
							valueText: '99',
							quoteAfter: '.',
							transform: 'number',
						},
					},
				},
			},
		})
		const provider = new EmailAiProvider({
			identity: {
				provider: 'Synthetic',
				model: 'test',
				contextTokens: 1050000,
			},
			complete: async() => response,
		})
		await expect(
			provider.check(
				approved,
				binding,
				new AbortController().signal,
				async() => {},
				provider.describe(),
				(e) => {
					events.push(e)
				},
			),
		).rejects.toThrow('EMAIL_AI_INVALID_EVIDENCE')
		expect(
			events.find((e) => e.step === 'ai_response')?.privateDetails?.response,
		).toBe(response)
		expect(events).toContainEqual(
			expect.objectContaining({
				step: 'evidence_resolution',
				status: 'failed',
				code: 'EMAIL_AI_INVALID_EVIDENCE',
				details: { field: 'income', check: 'QUOTE_NOT_FOUND' },
			}),
		)
		expect(
			JSON.stringify(events.map(({ privateDetails, ...e }) => (void privateDetails, e))),
		).not.toContain('PRIVATE')
	} finally {
		releaseApprovedEmail(approved)
	}
})

it('preserves a model insufficient reason and rejects it without a checked result', async() => {
	const policy = fixturePolicy(),
		binding = fixtureBinding(policy),
		events: EmailCheckEvent[] = []
	const approved = await approveWithResolver(
		await signCoreEmail(),
		policy,
		binding,
		new AbortController().signal,
		fixtureResolver,
	)
	const response = JSON.stringify({
		result: {
			outcome: 'insufficient',
			reason:
				'The document does not specify whether this belongs to the recipient.',
		},
	})
	const provider = new EmailAiProvider({
		identity: { provider: 'Synthetic', model: 'test', contextTokens: 1050000 },
		complete: async() => response,
	})
	try {
		await expect(
			provider.check(
				approved,
				binding,
				new AbortController().signal,
				async() => {},
				provider.describe(),
				(e) => {
					events.push(e)
				},
			),
		).rejects.toThrow('EMAIL_AI_INSUFFICIENT')
		expect(
			events.find((e) => e.step === 'ai_response')?.privateDetails?.response,
		).toBe(response)
		expect(events.at(-1)).toMatchObject({
			status: 'failed',
			code: 'EMAIL_AI_INSUFFICIENT',
		})
	} finally {
		releaseApprovedEmail(approved)
	}
})

it('diagnostic callbacks cannot mutate authentication results or turn logging failures into verification failures', async() => {
	const policy = fixturePolicy(),
		binding = fixtureBinding(policy)
	const frozen: boolean[] = []
	const approved = await approveWithResolver(
		await signCoreEmail(),
		policy,
		binding,
		new AbortController().signal,
		fixtureResolver,
		(event) => {
			frozen.push(Object.isFrozen(event))
			throw new Error('Logger unavailable')
		},
	)
	expect(frozen.length).toBeGreaterThan(0)
	expect(frozen.every(Boolean)).toBe(true)
	expect(projectApprovedEmail(approved, binding).sources).toHaveLength(1)
	releaseApprovedEmail(approved)
})

it('retains provider error codes/status/request ID without leaking echoed inputs or secrets', async() => {
	const client = new OpenAiEmailClient(
		{ apiKey: 'PRIVATE_API_KEY' },
		async() => Response.json(
			{
				error: {
					code: 'insufficient_quota',
					type: 'insufficient_quota',
					message: 'PRIVATE_API_KEY and PRIVATE_DOCUMENT',
				},
			},
			{ status: 429, headers: { 'x-request-id': 'req_example' } },
		),
	)
	const error = await client
		.complete(
			{
				systemPrompt: '',
				sourcesJson: '{}',
				taskJson: '{}',
				responseJsonSchema: {},
			},
			new AbortController().signal,
		)
		.catch((e) => e)
	expect(error.code).toBe('EMAIL_AI_PROVIDER_FAILED')
	expect(error.diagnostic).toEqual({
		httpStatus: 429,
		providerCode: 'insufficient_quota',
		providerType: 'insufficient_quota',
		requestId: 'req_example',
		stage: 'response_json',
		reason: 'HTTP_ERROR',
	})
	expect(JSON.stringify(error)).not.toContain('PRIVATE')
})
