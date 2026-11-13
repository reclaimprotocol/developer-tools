/* eslint-disable @stylistic/max-len -- ported from the email core's test suite; kept close to upstream so the two can be compared */
import {
	EMAIL_PROMPT_VERSION,
	EmailAiProvider,
} from '../../../src/email/core/ai.ts'
import { inspectCheckedEmail } from '../../../src/email/core/ai-check.ts'
import {
	approveWithResolver,
	projectApprovedEmail,
	releaseApprovedEmail,
} from '../../../src/email/core/approval.ts'
import {
	fixtureBinding,
	fixturePolicy,
	fixtureResolver,
	signCoreEmail,
} from './fixtures/email-core.ts'
import { expect, it, vi } from './vitest-compat.ts'

const identity = {
	provider: 'Synthetic',
	model: 'test',
	contextTokens: 1050000,
}
async function check(
	text: string,
	field: {
		value: string
		before: string
		literal: string
		after: string
		transform?: string
	},
	repeats = 1,
) {
	const policy = fixturePolicy({
		params: [
			{
				name: 'count',
				instructions:
					'Find the explicitly stated count for the named subject, preserving its scope.',
			},
		],
		instructions:
			'Find the explicitly stated count for the named subject, preserving its scope.',
	})
	const binding = fixtureBinding(policy)
	const approved = await approveWithResolver(
		await signCoreEmail({ body: (text + '\r\n').repeat(repeats) }),
		policy,
		binding,
		new AbortController().signal,
		fixtureResolver,
	)
	const complete = vi.fn(async(request) => {
		expect(request.systemPrompt).toContain('Direct lexical normalization')
		expect(request.systemPrompt).toContain(
			'differing facts must not be ignored',
		)
		expect(request.systemPrompt).toContain(
			'zero included/free items into zero total/ordered/owned items',
		)
		expect(JSON.stringify(request.responseJsonSchema)).toContain('"count"')
		return JSON.stringify({
			result: {
				outcome: 'pass',
				reviewedSourceIds: ['body:0'],
				fields: {
					count: {
						value: field.value,
						evidence: {
							sourceId: 'body:0',
							page: null,
							quoteBefore: field.before,
							valueText: field.literal,
							quoteAfter: field.after,
							transform: field.transform ?? 'count',
						},
					},
				},
			},
		})
	})
	const provider = new EmailAiProvider({ identity, complete })
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
		expect(complete).toHaveBeenCalledTimes(1)
		expect(result.analysis.promptVersion).toBe(EMAIL_PROMPT_VERSION)
		const source = projectApprovedEmail(approved, binding).sources[0]
		expect(result.fields.count.evidence.sourceSha256).toBe(source.textSha256)
		expect(
			source.text.slice(
				result.fields.count.evidence.valueStart,
				result.fields.count.evidence.valueEnd,
			),
		).toBe(field.literal)
		return result
	} finally {
		releaseApprovedEmail(approved)
	}
}

it.each([
	[
		'Customer Alice. No additional users enabled.',
		'Customer Alice. ',
		'No',
		' additional users enabled.',
		'0',
	],
	[
		'Account Alice. Dependents: none.',
		'Account Alice. Dependents: ',
		'none',
		'.',
		'0',
	],
	[
		'Registered devices: twenty-one.',
		'Registered devices: ',
		'twenty-one',
		'.',
		'21',
	],
	['Items in order: 2x items.', 'Items in order: ', '2', 'x items.', '2'],
	['Items in order: 2× items.', 'Items in order: ', '2', '× items.', '2'],
	['Items in order: TWO.', 'Items in order: ', 'TWO', '.', '2'],
	[
		'Synthetic passenger. No checked bag included in fare.',
		'Synthetic passenger. ',
		'No',
		' checked bag included in fare.',
		'0',
	],
])(
	'checks a contextual literal count in duplicated authenticated text: %s',
	async(text, before, literal, after, value) => {
		const result = await check(text, { value, before, literal, after }, 2)
		expect(result.fields.count.value).toBe(value)
		expect(result.fields.count.evidence.quoteStart).toBe(0)
	},
)
it.each([
	['Not specified.', '', 'No', 't specified.', '0', 'COUNT_TOKEN_BOUNDARY'],
	[
		'Someone else has access.',
		'Some',
		'one',
		' else has access.',
		'1',
		'COUNT_TOKEN_BOUNDARY',
	],
	['Count: 2×3.', 'Count: 2×', '3', '.', '3', 'COUNT_TOKEN_BOUNDARY'],
	['Count: 2x3.', 'Count: ', '2', 'x3.', '2', 'COUNT_TOKEN_BOUNDARY'],
	['Count: 2×3.', 'Count: ', '2', '×3.', '2', 'COUNT_TOKEN_BOUNDARY'],
	['Count: 12.', 'Count: 1', '2', '.', '2', 'COUNT_TOKEN_BOUNDARY'],
	['Count: -12.', 'Count: -', '12', '.', '12', 'COUNT_TOKEN_BOUNDARY'],
	['Count: 1.25.', 'Count: ', '1', '.25.', '1', 'COUNT_TOKEN_BOUNDARY'],
	['No users.', '', 'No users', '.', '0', 'COUNT_LITERAL_UNSUPPORTED'],
	[
		'Unknown users.',
		'',
		'Unknown',
		' users.',
		'0',
		'COUNT_LITERAL_UNSUPPORTED',
	],
	['No users.', '', 'No', '', '0', 'COUNT_CONTEXT_REQUIRED'],
	['No users.', '', 'No', ' users.', '4', 'VALUE_MISMATCH'],
])(
	'rejects unsupported or fabricated count normalization: %s',
	async(text, before, literal, after, value, detail) => {
		await expect(
			check(text, { value, before, literal, after }),
		).rejects.toMatchObject({ code: 'EMAIL_AI_INVALID_EVIDENCE', detail })
	},
)
it('does not silently reinterpret the model choosing the wrong numeric transform', async() => {
	await expect(
		check('No users.', {
			value: '0',
			before: '',
			literal: 'No',
			after: ' users.',
			transform: 'number',
		}),
	).rejects.toThrow('EMAIL_AI_INVALID_EVIDENCE')
})
