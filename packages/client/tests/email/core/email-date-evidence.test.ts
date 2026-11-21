/* eslint-disable @stylistic/max-len -- ported from the email core's test suite; kept close to upstream so the two can be compared */
import {
	EMAIL_PROMPT_VERSION,
	EmailAiProvider,
	type EmailModelRequest,
} from '../../../src/email/core/ai.ts'
import {
	inspectCheckedEmail,
	transformEmailValue,
} from '../../../src/email/core/ai-check.ts'
import {
	EMAIL_DATE_TRANSFORM_DESCRIPTION
} from '../../../src/email/core/ai-date.ts'
import {
	approveWithResolver,
	projectApprovedEmail,
	releaseApprovedEmail,
} from '../../../src/email/core/approval.ts'
import type { EmailCheckEvent } from '../../../src/email/core/check-events.ts'
import { pdfDocument } from './fixtures/documents.ts'
import {
	fixtureBinding,
	fixturePolicy,
	fixtureResolver,
	multipart,
	signCoreEmail,
} from './fixtures/email-core.ts'
import { expect, it, vi } from './vitest-compat.ts'

it.each([
	['23.10.2026', '2026-10-23'],
	['26.10.2026', '2026-10-26'],
	['23/10/2026', '2026-10-23'],
	['10/23/2026', '2026-10-23'],
	['23-10-2026', '2026-10-23'],
	['10-23-2026', '2026-10-23'],
	['10.23.2026', '2026-10-23'],
	['3.3.2026', '2026-03-03'],
	['2026/3/4', '2026-03-04'],
	['2026.03.04', '2026-03-04'],
	['2026-3-4', '2026-03-04'],
	['29.2.2024', '2024-02-29'],
	['2/29/2000', '2000-02-29'],
	['1.1.0001', '0001-01-01'],
	['31.12.9999', '9999-12-31'],
	['29 February 2024', '2024-02-29'],
])('normalizes an unambiguous calendar date %s', (literal, value) => {
	expect(transformEmailValue(literal, 'date')).toBe(value)
})
it.each([
	['03.04.2026', 'DATE_AMBIGUOUS'],
	['03/04/2026', 'DATE_AMBIGUOUS'],
	['03-04-2026', 'DATE_AMBIGUOUS'],
	['29.02.2023', 'DATE_INVALID'],
	['02/29/1900', 'DATE_INVALID'],
	['31.04.2026', 'DATE_INVALID'],
	['13.13.2026', 'DATE_INVALID'],
	['00.10.2026', 'DATE_INVALID'],
	['23.00.2026', 'DATE_INVALID'],
	['2026-00-01', 'DATE_INVALID'],
	['0000-01-01', 'DATE_INVALID'],
	['23.10/2026', 'DATE_FORMAT_UNSUPPORTED'],
	['23/10/26', 'DATE_FORMAT_UNSUPPORTED'],
	['2026-10-23T16:38', 'DATE_FORMAT_UNSUPPORTED'],
	['23.10.2026 trailing', 'DATE_FORMAT_UNSUPPORTED'],
	['23_10_2026', 'DATE_FORMAT_UNSUPPORTED'],
	[' 23.10.2026', 'DATE_FORMAT_UNSUPPORTED'],
])(
	'rejects unsupported/invalid/ambiguous date %s with a specific diagnostic',
	(literal, detail) => {
		try {
			transformEmailValue(literal, 'date')
			expect.unreachable()
		} catch(error) {
			expect(error).toMatchObject({ code: 'EMAIL_AI_INVALID_EVIDENCE', detail })
		}
	},
)

async function rental(
	start = '23.10.2026',
	proposed = '2026-10-23',
	selected = start,
	transform = 'date',
) {
	const policy = fixturePolicy({
		params: [
			{ name: 'startDate', instructions: 'Find the start date of the rental.' },
			{ name: 'endDate', instructions: 'Find the end date of the rental.' },
			{
				name: 'car',
				instructions: 'Retrieve the car make and model for this rental.',
			},
		],
	})
	const binding = fixtureBinding(policy),
		signal = new AbortController().signal
	const document = `Pickup: ${start}. Return: 26.10.2026. Vehicle: Audi Au A3 Sportk.`
	const raw = await signCoreEmail({
		contentType: 'multipart/mixed; boundary="synthetic"',
		body: multipart([
			{ type: 'text/plain', text: 'Your rental agreement is attached.' },
			{ type: 'text/html', text: '<p>Your rental agreement is attached.</p>' },
			{
				type: 'application/pdf',
				name: 'rental.pdf',
				encoding: 'base64',
				bytes: pdfDocument(document),
			},
		]),
	})
	const approved = await approveWithResolver(
		raw,
		policy,
		binding,
		signal,
		fixtureResolver,
	)
	const input = projectApprovedEmail(approved, binding),
		source = input.sources.find((s) => s.kind === 'attachment')!
	const events: Readonly<EmailCheckEvent>[] = []
	const complete = vi.fn(async(request: EmailModelRequest) => {
		expect(request.systemPrompt).toContain(EMAIL_DATE_TRANSFORM_DESCRIPTION)
		const fields = Object.fromEntries(
			[
				['startDate', selected, proposed, transform],
				['endDate', '26.10.2026', '2026-10-26', 'date'],
				['car', 'Audi Au A3 Sportk', 'Audi Au A3 Sportk', 'verbatim'],
			].map(([name, literal, value, transform]) => {
				const index = source.text.indexOf(literal)
				expect(index).toBeGreaterThanOrEqual(0)
				return [
					name,
					{
						value,
						evidence: {
							sourceId: source.id,
							page: 1,
							quoteBefore: source.text.slice(0, index),
							valueText: literal,
							quoteAfter: source.text.slice(index + literal.length),
							transform,
						},
					},
				]
			}),
		)
		return JSON.stringify({
			result: {
				outcome: 'pass',
				reviewedSourceIds: input.sources.map((s) => s.id),
				fields,
			},
		})
	})
	const provider = new EmailAiProvider({
		identity: { provider: 'Synthetic', model: 'test', contextTokens: 1050000 },
		complete,
	})
	try {
		const checked = await provider.check(
			approved,
			binding,
			signal,
			async() => {},
			provider.describe(),
			(e) => events.push(e),
		)
		const result = inspectCheckedEmail(checked, binding)
		expect(result.analysis.promptVersion).toBe(EMAIL_PROMPT_VERSION)
		expect(complete).toHaveBeenCalledTimes(1)
		return { result, events }
	} catch(error) {
		return { error, events }
	} finally {
		releaseApprovedEmail(approved)
	}
}

it('accepts the reported rental dates through DKIM, PDF extraction, AI quote resolution and deterministic validation', async() => {
	const { result, error, events } = await rental()
	expect(error).toBeUndefined()
	expect(
		Object.fromEntries(
			Object.entries(result!.fields).map(([name, field]) => [
				name,
				field.value,
			]),
		),
	).toEqual({
		startDate: '2026-10-23',
		endDate: '2026-10-26',
		car: 'Audi Au A3 Sportk',
	})
	expect(result!.fields.startDate.evidence).toMatchObject({
		page: 1,
		transform: 'date',
	})
	expect(
		events.filter((e) => e.step === 'evidence_validation').map((e) => e.status),
	).toEqual(['passed', 'passed', 'passed'])
})
it.each([
	['03.04.2026', '2026-04-03', '03.04.2026', 'DATE_AMBIGUOUS'],
	['31.02.2026', '2026-02-28', '31.02.2026', 'DATE_INVALID'],
	['23_10_2026', '2026-10-23', '23_10_2026', 'DATE_FORMAT_UNSUPPORTED'],
	['23.10.2026', '2026-10-24', '23.10.2026', 'VALUE_MISMATCH'],
	['123.10.2026', '2026-10-23', '23.10.2026', 'DATE_TOKEN_BOUNDARY'],
])(
	'rejects a fabricated date conversion with itemized diagnostics: %s',
	async(literal, value, selected, check) => {
		const { result, error, events } = await rental(literal, value, selected)
		expect(result).toBeUndefined()
		expect(error).toMatchObject({
			code: 'EMAIL_AI_INVALID_EVIDENCE',
			detail: check,
		})
		expect(events).toContainEqual(
			expect.objectContaining({
				step: 'evidence_validation',
				status: 'failed',
				details: { field: 'startDate', transform: 'date', check },
			}),
		)
	},
)
it('can preserve an ambiguous source date verbatim without claiming a guessed ISO date', async() => {
	const { result, error } = await rental(
		'03.04.2026',
		'03.04.2026',
		'03.04.2026',
		'verbatim',
	)
	expect(error).toBeUndefined()
	expect(result!.fields.startDate.value).toBe('03.04.2026')
})
