/* eslint-disable @stylistic/max-len, @typescript-eslint/no-explicit-any -- ported from the email core's test suite; kept close to upstream so the two can be compared */
import {
	EMAIL_SYSTEM_PROMPT,
	EmailAiProvider,
	type EmailModelRequest,
} from '../../../src/email/core/ai.ts'
import { inspectCheckedEmail } from '../../../src/email/core/ai-check.ts'
import {
	approveWithResolver,
	projectApprovedEmail,
	releaseApprovedEmail,
} from '../../../src/email/core/approval.ts'
import {
	copyNormalizedPolicy,
	hashEmailPolicy,
	normalizeEmailPolicy,
} from '../../../src/email/core/policy.ts'
import {
	fixtureBinding,
	fixturePolicy,
	fixtureResolver,
	signCoreEmail,
} from './fixtures/email-core.ts'
import { expect, test } from './vitest-compat.ts'

const definition = {
	name: 'serviceA',
	instructions: 'Find the hold baggage count.\nKeep its stated scope.',
}
test('field instructions survive normalization exactly, freeze, and change the policy binding', () => {
	const source = { ...definition }
	const policy = fixturePolicy({ params: [source] })
	expect(policy.version).toBe('email-dkim-v5')
	expect(policy.params).toEqual([{ ...definition, isOptional: false }])
	source.instructions = 'Find another fact.'
	expect(policy.params[0].instructions).toBe(definition.instructions)
	expect(Object.isFrozen(policy.params[0])).toBe(true)
	expect(copyNormalizedPolicy(policy)).toEqual(policy)
	expect(hashEmailPolicy(fixturePolicy({ params: [source] }))).not.toBe(
		hashEmailPolicy(policy),
	)
	expect(() => copyNormalizedPolicy({ ...policy, version: 'email-dkim-v4' } as any),
	).toThrow()
})
test('missing, blank, oversized, accessor and unknown field definitions fail before analysis', () => {
	for(const params of [
		['serviceA'],
		[{ name: 'serviceA' }],
		[{ ...definition, instructions: '' }],
		[{ ...definition, instructions: ' \n\t' }],
		[{ ...definition, instructions: 'x'.repeat(10001) }],
		[{ ...definition, instructions: 1 }],
		[{ ...definition, script: 'execute()' }],
	]) {
		expect(() => fixturePolicy({
			params: params as any,
			instructions: 'Shared text cannot define missing fields.',
		}),
		).toThrow()
	}

	let called = false
	expect(() => fixturePolicy({
		params: [
			{
				name: 'serviceA',
				get instructions() {
					called = true
					return 'Find it'
				},
			},
		],
	}),
	).toThrow()
	expect(called).toBe(false)
	expect(() => normalizeEmailPolicy({
		...fixturePolicy(),
		params: Array.from({ length: 32 }, (_, n) => ({
			name: `f${n}`,
			instructions: 'x'.repeat(3000),
		})),
	}),
	).toThrow()
})
test('opaque/misleading names pass distinct signed field instructions to one model call and retain evidence bindings', async() => {
	const params = [
		{ name: 'salary', instructions: 'Find the hold baggage count.' },
		{ name: 'serviceB', instructions: 'Find the booking reference.' },
		{
			name: 'serviceC',
			instructions: 'Find the assigned seat.',
			isOptional: true,
		},
	]
	const policy = fixturePolicy({
		params,
		instructions: 'Use the confirmed reservation.',
	})
	const binding = fixtureBinding(policy)
	const approved = await approveWithResolver(
		await signCoreEmail({
			body: 'Hold baggage count: 2. Booking reference: ABC123.',
		}),
		policy,
		binding,
		new AbortController().signal,
		fixtureResolver,
	)
	let calls = 0
	const provider = new EmailAiProvider({
		identity: {
			provider: 'Synthetic',
			model: 'fixture',
			contextTokens: 100000,
		},
		complete: async(request: EmailModelRequest) => {
			calls++
			expect(JSON.parse(request.taskJson).task).toEqual({
				params: policy.params,
				instructions: policy.instructions,
				contentScope: policy.contentScope,
			})
			expect(request.systemPrompt).toBe(EMAIL_SYSTEM_PROMPT)
			expect(request.systemPrompt).toContain(
				'Parameter names are opaque output identifiers',
			)
			const [source] = JSON.parse(request.sourcesJson).sources
			const field = (value: string, transform: string) => ({
				value,
				evidence: {
					sourceId: source.id,
					page: null,
					valueText: value,
					quoteBefore: source.text.slice(0, source.text.indexOf(value)),
					quoteAfter: source.text.slice(
						source.text.indexOf(value) + value.length,
					),
					transform,
				},
			})
			return JSON.stringify({
				result: {
					outcome: 'pass',
					reviewedSourceIds: [source.id],
					fields: {
						salary: field('2', 'count'),
						serviceB: field('ABC123', 'verbatim'),
						serviceC: null,
					},
				},
			})
		},
	})
	try {
		const result = inspectCheckedEmail(
			await provider.check(
				approved,
				binding,
				new AbortController().signal,
				async() => {},
				provider.describe(),
			),
			binding,
		)
		expect(result.fields.salary.value).toBe('2')
		expect(result.fields.serviceB.value).toBe('ABC123')
		expect(result.omittedOptional).toEqual(['serviceC'])
		expect(calls).toBe(1)
		const changed = fixturePolicy({
			params: [
				{ ...params[0], instructions: 'Find the airfare.' },
				...params.slice(1),
			],
		})
		expect(() => projectApprovedEmail(approved, fixtureBinding(changed)),
		).toThrow()
	} finally {
		releaseApprovedEmail(approved)
	}
})
